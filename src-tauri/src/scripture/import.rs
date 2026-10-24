//! Bible import: choose file → detect format → parse → normalise →
//! validate → preview → confirm → commit.
//!
//! [`stage`] does everything up to the preview and returns a
//! [`StagedImport`] held in memory; nothing touches the database until the
//! user confirms and `db::bibles::commit_import` writes it in one
//! transaction. Cancelling simply drops the staged import.
//!
//! Formats are read by a [`BibleImportAdapter`]: USFM (loose `.usfm`/`.sfm`
//! files or a `.zip` of them) since v0.2; the Open Scriptures Hebrew Bible's
//! OSIS and MorphGNT since v0.22 (`oshb`, `morphgnt`). Other OSIS, USX, PDF,
//! EPUB and similar files are recognised and refused clearly rather than
//! guessed at.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::canon::{self, Book, NON_CANONICAL_USFM_CODES};
use crate::scripture::documents;
use crate::scripture::grammar::{self, GrammarFinding, Statement};
use crate::scripture::morphgnt::MorphGntAdapter;
use crate::scripture::oshb::{self, OshbAdapter};
use crate::scripture::structure;
use crate::scripture::usfm::{self, MarkedWord, WordShape};
use crate::scripture::versification::{self, VerseMap};
use crate::scripture::words::{self, AttributeProblem};

/// Refuse anything bigger: a full Bible in USFM is under 20 MB.
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

/// One text file handed to an adapter.
pub struct SourceText {
    pub name: String,
    pub text: String,
}

/// A format reader. Implementations turn source files into normalised
/// book/chapter/verse content plus the problems they noticed.
pub trait BibleImportAdapter {
    /// Short format name stored with the translation, e.g. "usfm".
    fn format(&self) -> &'static str;
    fn can_read(&self, file: &SourceText) -> bool;
    fn read(&self, files: &[SourceText], staged: &mut StagedContent);
}

pub struct UsfmAdapter;

impl BibleImportAdapter for UsfmAdapter {
    fn format(&self) -> &'static str {
        "usfm"
    }

    fn can_read(&self, file: &SourceText) -> bool {
        file.text
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with("\\id ")
    }

    fn read(&self, files: &[SourceText], staged: &mut StagedContent) {
        for file in files {
            let doc = usfm::parse(&file.text);
            if !doc.unknown_markers.is_empty() {
                log::info!(
                    "import: {} uses unrecognised markers (ignored): {}",
                    file.name,
                    doc.unknown_markers.join(", ")
                );
            }
            let Some(code) = doc.book_code.clone() else {
                staged.issue(
                    Severity::Error,
                    None,
                    None,
                    UserMessage::new(
                        "bibleImport.noBookId",
                        format!(
                            "The file “{}” does not say which book it contains.",
                            file.name
                        ),
                    )
                    .with("fileName", &file.name),
                );
                continue;
            };
            let Some(book) = canon::by_code(&code) else {
                if NON_CANONICAL_USFM_CODES.contains(&code.as_str()) {
                    staged.skipped_files.push(file.name.clone());
                } else {
                    staged.issue(
                        Severity::Warning,
                        None,
                        None,
                        UserMessage::new(
                            "bibleImport.unknownBook",
                            format!(
                                "The file “{}” contains a book Abiding Word does not recognise ({code}). It was left out.",
                                file.name
                            ),
                        )
                        .with("fileName", &file.name)
                        .with("code", &code),
                    );
                }
                continue;
            };
            if staged.books.contains_key(&book.ordinal) {
                staged.issue(
                    Severity::Error,
                    Some(book),
                    None,
                    UserMessage::new(
                        "bibleImport.bookTwice",
                        format!("{} appears in more than one file.", book.name),
                    )
                    .with("bookCode", book.code),
                );
                continue;
            }
            let mut content = StagedBook::default();
            if doc.verses_outside_chapter > 0 {
                staged.issue(
                    Severity::Error,
                    Some(book),
                    None,
                    UserMessage::new(
                        "bibleImport.versesBeforeChapter",
                        format!(
                            "{}: some verses appear before the first chapter.",
                            book.name
                        ),
                    )
                    .with("bookCode", book.code),
                );
            }
            staged.words.read_problems(&doc.word_problems);
            for verse in doc.verses {
                let annotated = staged.words.annotate(verse.words);
                staged.add_verse(
                    book,
                    &mut content,
                    &verse.chapter,
                    &verse.label,
                    verse.text,
                    annotated,
                );
            }
            for (chapter, text) in doc.superscriptions {
                if let Ok(number) = chapter.parse::<u16>() {
                    if (1..=book.chapter_count).contains(&number) {
                        content.chapters.entry(number).or_default().superscription = Some(text);
                    }
                }
            }
            staged.books.insert(book.ordinal, content);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Blocks the import.
    Error,
    /// Worth reviewing; the import can go ahead.
    Warning,
    /// For information only.
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub severity: Severity,
    pub book: Option<&'static str>,
    pub chapter: Option<u16>,
    /// Plain English; the interface shows `code` translated (docs/i18n.md).
    pub message: String,
    pub code: Option<String>,
    pub params: BTreeMap<String, String>,
}

/// One annotated word, placed in its verse's text (v0.21).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedWord {
    /// UTF-16 offsets into the verse text, end exclusive.
    pub start: usize,
    pub end: usize,
    pub surface: String,
    pub shape: WordShape,
    pub lemma: Option<String>,
    pub strong: Option<String>,
    pub morph: Option<String>,
    /// Every lexical identifier of `strong` (values and parts).
    pub ids: Vec<String>,
}

/// Annotated words left out of the index, by reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordsLeftOut {
    /// Attribute lists not following the USFM syntax.
    pub syntax: usize,
    /// An attribute given two different values.
    pub conflict: usize,
    pub too_long: usize,
    /// `\w` never closed, `\w*` never opened, a list with no word.
    pub unbalanced: usize,
    /// Marked words inside other marked words.
    pub overlapping: usize,
    /// Annotated words outside verse text (headings, titles, introductions).
    pub outside_verse: usize,
    /// Marks around punctuation only.
    pub empty: usize,
    /// In a verse with more marked words than any real verse has.
    pub too_many: usize,
}

impl WordsLeftOut {
    pub fn total(&self) -> usize {
        self.syntax
            + self.conflict
            + self.too_long
            + self.unbalanced
            + self.overlapping
            + self.empty
            + self.too_many
    }
}

/// What the import found in the Bible's word markup, shown before adding it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordReport {
    /// Marked words that carry attributes (read or not).
    pub marked: usize,
    /// Words kept, with their verses.
    pub words: usize,
    pub verses: usize,
    pub with_lemma: usize,
    pub with_lexical_id: usize,
    pub with_morphology: usize,
    pub distinct_lemmas: usize,
    /// Multi-word units and parts of written words among the kept words.
    pub phrases: usize,
    pub parts: usize,
    pub morph_attribute: Option<String>,
    /// Which documented scheme the grammar codes fit, and whether the
    /// edition itself says so (v0.22, `scripture::grammar`).
    pub grammar: GrammarFinding,
    /// Other attribute names present, not read (e.g. "srcloc").
    pub other_attributes: Vec<String>,
    pub left_out: WordsLeftOut,
    /// Whether the words are added to the word index.
    pub indexed: bool,
    /// Why not: "strongOnly" (lexical numbers only: indexed only when the
    /// person asks, v0.22), "unreliable", "unreadable" or "tooLarge".
    pub not_indexed: Option<&'static str>,
    /// About how much the word index would take on disk (bytes).
    pub estimated_bytes: usize,
}

/// Bytes a stored word takes, measured on a whole generated Bible (v0.21:
/// 37.3 MiB for 777,600 words).
pub const BYTES_PER_WORD: usize = 51;

/// More marked words than this in one verse cannot be real (the longest verse
/// has under 100 words).
pub const WORDS_PER_VERSE_MAX: usize = 1_000;
/// More annotated words than any Bible has (the whole Bible: about 800,000).
pub const WORDS_MAX: usize = 2_000_000;

/// Collects the words of an import and what was left out (v0.21).
#[derive(Debug, Default)]
pub struct WordCollector {
    pub report: WordReport,
    unreadable: bool,
    morph_attributes: BTreeSet<&'static str>,
}

impl WordCollector {
    fn read_problems(&mut self, problems: &usfm::WordProblems) {
        let left = &mut self.report.left_out;
        left.unbalanced += problems.unclosed + problems.orphan_attributes;
        left.too_many += problems.too_many;
        left.overlapping += problems.overlapping;
        left.outside_verse += problems.outside_verse;
        left.empty += problems.empty;
        self.unreadable |= problems.unreadable;
        self.report.marked += problems.total();
    }

    /// Words a structured format gives (OSIS, MorphGNT): already read, so
    /// only counted (v0.22).
    pub fn add_structured(
        &mut self,
        words: Vec<StagedWord>,
        morph_attribute: &'static str,
    ) -> Vec<StagedWord> {
        self.report.marked += words.len();
        if words.len() > WORDS_PER_VERSE_MAX {
            self.report.left_out.too_many += words.len();
            return Vec::new();
        }
        if words.iter().any(|w| w.morph.is_some()) {
            self.morph_attributes.insert(morph_attribute);
        }
        words
    }

    /// The verse's marked words that carry readable annotations.
    fn annotate(&mut self, marked: Vec<MarkedWord>) -> Vec<StagedWord> {
        let with_attributes: Vec<MarkedWord> = marked
            .into_iter()
            .filter(|w| w.attributes.is_some())
            .collect();
        self.report.marked += with_attributes.len();
        if with_attributes.len() > WORDS_PER_VERSE_MAX {
            self.report.left_out.too_many += with_attributes.len();
            return Vec::new();
        }
        let mut out = Vec::new();
        for word in with_attributes {
            let raw = word.attributes.as_deref().unwrap_or_default();
            match words::parse_attributes(raw) {
                Ok(attributes) => {
                    for name in &attributes.other {
                        if !self.report.other_attributes.contains(name)
                            && self.report.other_attributes.len() < 20
                        {
                            self.report.other_attributes.push(name.clone());
                        }
                    }
                    if let Some(name) = attributes.morph_attribute {
                        self.morph_attributes.insert(name);
                    }
                    if attributes.is_empty() {
                        continue;
                    }
                    out.push(StagedWord {
                        start: word.start,
                        end: word.end,
                        surface: word.surface,
                        shape: word.shape,
                        ids: attributes.lexical_ids(),
                        lemma: attributes.lemma,
                        strong: attributes.strong,
                        morph: attributes.morph,
                    });
                }
                Err(problem) => {
                    let left = &mut self.report.left_out;
                    match problem {
                        AttributeProblem::Syntax => left.syntax += 1,
                        AttributeProblem::Conflict => left.conflict += 1,
                        AttributeProblem::TooLong => left.too_long += 1,
                    }
                }
            }
        }
        out
    }
}

#[derive(Debug, Default)]
pub struct StagedChapter {
    pub verses: BTreeMap<u16, String>,
    /// Annotated words of each verse, in order (v0.21; only when indexed).
    pub words: BTreeMap<u16, Vec<StagedWord>>,
    /// Bridged verses (v0.18.8): the first verse of a bridge such as "4-5"
    /// and its last; the text is stored on the first.
    pub bridges: BTreeMap<u16, u16>,
    pub superscription: Option<String>,
}

#[derive(Debug, Default)]
pub struct StagedBook {
    pub chapters: BTreeMap<u16, StagedChapter>,
}

/// Normalised, validated content waiting for confirmation.
#[derive(Debug, Default)]
pub struct StagedContent {
    pub books: BTreeMap<u8, StagedBook>,
    pub issues: Vec<ImportIssue>,
    pub skipped_files: Vec<String>,
    /// The Bible's word annotations (v0.21).
    pub words: WordCollector,
    /// Text files that came with the Bible (copr.htm, README, front matter),
    /// read only for what they say about the edition (v0.22).
    pub notes: Vec<(String, String)>,
    /// The grammar scheme the format itself names (OSHB OSIS, MorphGNT).
    pub declared_grammar: Option<(&'static str, Statement)>,
    /// Names and licence the files themselves state.
    pub hints: Hints,
    /// A Hebrew-to-English verse map supplied with the files (v0.22).
    pub verse_map: Option<VerseMap>,
    /// Verses read while a verse map waits to be applied or not.
    held: Vec<HeldVerse>,
    /// Places the text itself marked where an English verse begins inside
    /// a Hebrew one (OSHB's `KJV:` notes), so the verse could be divided.
    pub split_marks: BTreeSet<u8>,
}

/// What the files themselves state about the edition (v0.22).
#[derive(Debug, Default)]
pub struct Hints {
    pub name: Option<String>,
    pub license: Option<String>,
}

#[derive(Debug)]
struct HeldVerse {
    ordinal: u8,
    chapter: String,
    label: String,
    text: String,
    words: Vec<StagedWord>,
    /// Which part of a Hebrew verse the text divided (`a`, `b`…), if any.
    part: Option<char>,
    /// The English verse the text says this part (or verse) begins.
    marker: Option<(u16, u16)>,
}

/// A verse, or the part of one, as an adapter read it (v0.22.1): the part
/// letter when the text divided the verse at its own mark, and the English
/// verse that mark names.
#[derive(Debug, Clone, Copy, Default)]
pub struct VersePart {
    pub part: Option<char>,
    pub marker: Option<(u16, u16)>,
}

/// Where a held verse goes.
enum Placement {
    /// Its own number.
    Own,
    /// An English verse (chapter, verse).
    To(u16, u16),
    /// The chapter's title (a Psalm's superscription).
    Title,
}

impl StagedContent {
    pub(super) fn issue(
        &mut self,
        severity: Severity,
        book: Option<&'static Book>,
        chapter: Option<u16>,
        message: UserMessage,
    ) {
        self.issues.push(ImportIssue {
            severity,
            book: book.map(|b| b.code),
            chapter,
            code: message.code.map(String::from),
            params: message
                .params
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
            message: message.text,
        });
    }

    pub(super) fn add_verse(
        &mut self,
        book: &'static Book,
        content: &mut StagedBook,
        chapter: &str,
        label: &str,
        text: String,
        words: Vec<StagedWord>,
    ) {
        self.add_verse_part(
            book,
            content,
            chapter,
            label,
            VersePart::default(),
            text,
            words,
        );
    }

    /// Adds a verse or one part of it (v0.22.1).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn add_verse_part(
        &mut self,
        book: &'static Book,
        content: &mut StagedBook,
        chapter: &str,
        label: &str,
        part: VersePart,
        text: String,
        words: Vec<StagedWord>,
    ) {
        // A verse map waits until the whole text is read (v0.22).
        if self.verse_map.is_some() {
            let (mut text, mut words) = (text, words);
            // A paseq (׀) where the text's mark falls just before it divides the
            // words before it from those after: it belongs with the part before.
            if part.part.is_some_and(|p| p != 'a') && text.starts_with('׀') {
                if let Some(previous) = self.held.last_mut().filter(|h| {
                    h.ordinal == book.ordinal && h.chapter == chapter && h.label == label
                }) {
                    let rest = text['׀'.len_utf8()..].trim_start();
                    let removed_units = text[..text.len() - rest.len()].encode_utf16().count();
                    previous.text.push_str(" ׀");
                    text = rest.to_string();
                    for w in &mut words {
                        w.start -= removed_units;
                        w.end -= removed_units;
                    }
                }
            }
            let words = words;
            self.held.push(HeldVerse {
                ordinal: book.ordinal,
                chapter: chapter.to_string(),
                label: label.to_string(),
                text,
                words,
                part: part.part,
                marker: part.marker,
            });
            return;
        }
        // Parts are made only with a map; without one a verse is whole.
        self.place_verse(book, content, chapter, label, text, words);
    }

    fn place_verse(
        &mut self,
        book: &'static Book,
        content: &mut StagedBook,
        chapter: &str,
        label: &str,
        text: String,
        words: Vec<StagedWord>,
    ) {
        let name = book.name;
        let Ok(chapter) = chapter.parse::<u16>() else {
            self.issue(
                Severity::Error,
                Some(book),
                None,
                UserMessage::new(
                    "bibleImport.badChapterNumber",
                    format!("{name}: the chapter number “{chapter}” could not be read."),
                )
                .with("bookCode", book.code)
                .with("label", chapter),
            );
            return;
        };
        if chapter == 0 || chapter > book.chapter_count {
            // Once per chapter, not once per verse.
            let said = self.issues.iter().any(|i| {
                i.code.as_deref() == Some("bibleImport.chapterOutOfRange")
                    && i.book == Some(book.code)
                    && i.chapter == Some(chapter)
            });
            if said {
                return;
            }
            self.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.chapterOutOfRange",
                    format!(
                        "{name} {chapter}: {name} has {} chapter{} in the standard numbering.",
                        book.chapter_count,
                        if book.chapter_count == 1 { "" } else { "s" }
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("count", book.chapter_count),
            );
            return;
        }
        // "4", or a bridge such as "4-5" (stored on its first verse).
        let (first, last) = match label.split_once(['-', '–']) {
            Some((a, b)) => (a.parse::<u16>().ok(), b.parse::<u16>().ok()),
            None => (label.parse::<u16>().ok(), None),
        };
        let Some(verse) =
            first.filter(|v| (1..=crate::scripture::reference::MAX_VERSE).contains(v))
        else {
            self.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.badVerseNumber",
                    format!("{name} {chapter}: the verse number “{label}” could not be read."),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("label", label),
            );
            return;
        };
        if let Some(last) = last {
            if last <= verse {
                self.issue(
                    Severity::Error,
                    Some(book),
                    Some(chapter),
                    UserMessage::new(
                        "bibleImport.badVerseNumber",
                        format!("{name} {chapter}: the verse number “{label}” could not be read."),
                    )
                    .with("bookCode", book.code)
                    .with("chapter", chapter)
                    .with("label", label),
                );
                return;
            }
            self.issue(
                Severity::Note,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.bridged",
                    format!(
                        "{name} {chapter}:{verse}–{last} are combined into one verse in this translation."
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("first", verse)
                .with("last", last),
            );
        }
        let verses = &mut content.chapters.entry(chapter).or_default().verses;
        if verses.contains_key(&verse) {
            self.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.verseTwice",
                    format!("{name} {chapter}:{verse} appears twice."),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("verse", verse),
            );
            return;
        }
        if text.trim().is_empty() {
            self.issue(
                Severity::Warning,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.emptyVerse",
                    format!("{name} {chapter}:{verse} has no text."),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("verse", verse),
            );
        }
        verses.insert(verse, text);
        if !words.is_empty() {
            content
                .chapters
                .entry(chapter)
                .or_default()
                .words
                .insert(verse, words);
        }
        if let Some(last) = last {
            content
                .chapters
                .entry(chapter)
                .or_default()
                .bridges
                .insert(verse, last);
        }
    }

    /// Places the held verses, through the verse map when the text uses
    /// Hebrew numbering (rules: `scripture::versification`).
    fn release_held(&mut self) {
        let Some(map) = self.verse_map.take() else {
            return;
        };
        let held = std::mem::take(&mut self.held);
        let apply = self.held_is_hebrew_numbered_in(&held, &map);
        let (mut moved, mut joined, mut titles) = (0usize, 0usize, 0usize);
        // Hebrew verses divided at the text's marks, and their parts that are Psalm titles.
        let mut divided: BTreeSet<(u8, u16, u16)> = BTreeSet::new();
        let mut title_parts = 0usize;
        // Where each English verse's text came from (its Hebrew verse), so a
        // part never takes an earlier part of the same Hebrew verse for a title.
        let mut source_of: std::collections::HashMap<(u8, u16, u16), (u16, u16)> =
            std::collections::HashMap::new();
        // Verses placed through the map, per book and chapter.
        let mut mapped: BTreeSet<(u8, u16, u16)> = BTreeSet::new();
        // Hebrew verses whose second part begins English verse 1 (Psalm titles inside verse 1).
        let title_first: BTreeSet<(u8, u16, u16)> = held
            .iter()
            .filter(|v| v.part.is_some_and(|p| p != 'a'))
            .filter_map(|v| {
                let (c, n) = (v.chapter.parse().ok()?, v.label.parse().ok()?);
                (v.marker.is_some_and(|(mc, mv)| mc == c && mv == 1)).then_some((v.ordinal, c, n))
            })
            .collect();
        // Hebrew verses the map divides but the text does not mark, and
        // places where the text's mark and the map disagree (v0.22.1).
        let mut unsplit: Vec<String> = Vec::new();
        let mut conflicts: Vec<String> = Vec::new();
        if apply {
            let whole: BTreeSet<(u8, u16, u16)> = held
                .iter()
                .filter(|v| v.part.is_none())
                .filter_map(|v| Some((v.ordinal, v.chapter.parse().ok()?, v.label.parse().ok()?)))
                .collect();
            let mut keys: Vec<(u8, u16, u16)> = map
                .parts
                .keys()
                .map(|(o, c, v, _)| (*o, *c, *v))
                .filter(|k| whole.contains(k))
                .collect();
            keys.sort();
            keys.dedup();
            unsplit = keys
                .iter()
                .filter_map(|(o, c, v)| canonical(*o, *c, *v))
                .collect();
        }
        for verse in held {
            let Some(book) = canon::by_ordinal(verse.ordinal) else {
                continue;
            };
            let mut content = self.books.remove(&verse.ordinal).unwrap_or_default();
            let numbers = verse
                .chapter
                .parse::<u16>()
                .ok()
                .zip(verse.label.parse::<u16>().ok());
            let placement = match (apply, numbers, verse.part) {
                (false, _, _) | (_, None, _) => Placement::Own,
                (true, Some((c, v)), None) => match map.to_english.get(&(verse.ordinal, c, v)) {
                    Some(&(tc, tv)) => Placement::To(tc, tv),
                    None => Placement::Own,
                },
                (true, Some((c, v)), Some(p)) => {
                    divided.insert((verse.ordinal, c, v));
                    let from_map = map.parts.get(&(verse.ordinal, c, v, p)).copied();
                    if let (Some(m), Some(t)) = (verse.marker, from_map) {
                        if m != t {
                            conflicts.extend(canonical(verse.ordinal, c, v));
                        }
                    }
                    // The text's own mark first, then the map's entry for this part.
                    match verse.marker.or(from_map) {
                        Some((tc, tv)) => Placement::To(tc, tv),
                        // The words before English verse 1 of a Psalm: its title.
                        None if verse.ordinal == 19
                            && p == 'a'
                            && title_first.contains(&(verse.ordinal, c, v)) =>
                        {
                            Placement::Title
                        }
                        None => Placement::Own,
                    }
                }
            };
            match placement {
                Placement::Title => {
                    title_parts += 1;
                    let (c, _) = numbers.unwrap_or_default();
                    let chapter = content.chapters.entry(c).or_default();
                    self.words.report.left_out.outside_verse += verse.words.len();
                    chapter.superscription = Some(match chapter.superscription.take() {
                        Some(before) => format!("{before} {}", verse.text),
                        None => verse.text,
                    });
                    titles += 1;
                }
                Placement::Own => {
                    let occupied = numbers.is_some_and(|(c, v)| {
                        content
                            .chapters
                            .get(&c)
                            .is_some_and(|ch| ch.verses.contains_key(&v))
                    });
                    match numbers {
                        // Where a mapped verse (or part) already is: one English verse.
                        Some((c, v))
                            if apply && occupied && mapped.contains(&(verse.ordinal, c, v)) =>
                        {
                            join(&mut content, c, v, verse.text, verse.words);
                            joined += 1;
                        }
                        _ => {
                            if let Some((c, v)) = numbers {
                                source_of.entry((verse.ordinal, c, v)).or_insert((c, v));
                            }
                            self.place_verse(
                                book,
                                &mut content,
                                &verse.chapter,
                                &verse.label,
                                verse.text,
                                verse.words,
                            )
                        }
                    }
                }
                Placement::To(c, v) => {
                    if numbers != Some((c, v)) {
                        moved += 1;
                    }
                    let chapter = content.chapters.entry(c).or_default();
                    let occupant = chapter.verses.contains_key(&v);
                    let occupant_mapped = mapped.contains(&(verse.ordinal, c, v));
                    // In Psalms, what is already at a verse (or at verse 1, even if
                    // mapped there too: some titles are two Hebrew verses) is the
                    // title the English numbering does not count as a verse.
                    // …but never an earlier part of this same Hebrew verse: that is joined.
                    let same_verse =
                        numbers.is_some_and(|n| source_of.get(&(verse.ordinal, c, v)) == Some(&n));
                    if occupant
                        && verse.ordinal == 19
                        && !same_verse
                        && (!occupant_mapped || v == 1)
                    {
                        let title = chapter.verses.remove(&v).unwrap_or_default();
                        if let Some(words) = chapter.words.remove(&v) {
                            self.words.report.left_out.outside_verse += words.len();
                        }
                        chapter.superscription = Some(match chapter.superscription.take() {
                            Some(before) => format!("{before} {title}"),
                            None => title,
                        });
                        titles += 1;
                        self.place_verse(
                            book,
                            &mut content,
                            &c.to_string(),
                            &v.to_string(),
                            verse.text,
                            verse.words,
                        );
                    } else if occupant {
                        join(&mut content, c, v, verse.text, verse.words);
                        joined += 1;
                    } else {
                        self.place_verse(
                            book,
                            &mut content,
                            &c.to_string(),
                            &v.to_string(),
                            verse.text,
                            verse.words,
                        );
                    }
                    mapped.insert((verse.ordinal, c, v));
                    if let Some(n) = numbers {
                        source_of.entry((verse.ordinal, c, v)).or_insert(n);
                    }
                }
            }
            self.books.insert(verse.ordinal, content);
        }
        let message = if apply {
            UserMessage::new(
                "bibleImport.verseMapApplied",
                format!(
                    "This text uses the Hebrew Bible's verse numbers. They were changed to the English numbering with the verse map supplied ({moved} verses renumbered, {joined} joined, {titles} Psalm titles kept as titles)."
                ),
            )
            .with("moved", moved)
            .with("joined", joined)
            .with("titles", titles)
        } else {
            UserMessage::new(
                "bibleImport.verseMapUnused",
                "The verse map supplied was not used: these files already follow the English verse numbers.",
            )
        };
        self.issue(Severity::Note, None, None, message);
        if !divided.is_empty() {
            let count = divided.len();
            self.issue(
                Severity::Note,
                None,
                None,
                UserMessage::new(
                    "bibleImport.verseMapDivided",
                    format!("{count} Hebrew verses were divided where the text itself marks the start of an English verse ({title_parts} of the parts are Psalm titles)."),
                )
                .with("count", count)
                .with("titles", title_parts),
            );
        }
        if !unsplit.is_empty() {
            self.issue(
                Severity::Warning,
                None,
                None,
                UserMessage::new(
                    "bibleImport.verseMapUnsplit",
                    format!(
                        "These Hebrew verses each hold parts of two English verses, and the files do not mark where one ends: {}. Each is kept whole under its Hebrew number, so it also holds words of the neighbouring English verse, and that verse is incomplete or missing.",
                        unsplit.join("; ")
                    ),
                )
                .with("places", unsplit.join(";"))
                .with("count", unsplit.len()),
            );
        }
        if !conflicts.is_empty() {
            self.issue(
                Severity::Warning,
                None,
                None,
                UserMessage::new(
                    "bibleImport.verseMapConflict",
                    format!(
                        "At {} the text's own verse mark and the verse map disagree; the text's mark was followed.",
                        conflicts.join("; ")
                    ),
                )
                .with("places", conflicts.join(";"))
                .with("count", conflicts.len()),
            );
        }
        // Without the text's own marks, Psalm titles inside verse 1 cannot be told apart.
        if apply && !self.split_marks.contains(&19) && self.books.contains_key(&19) {
            self.issue(
                Severity::Note,
                Some(canon::by_ordinal(19).unwrap_or(&canon::BOOKS[18])),
                None,
                UserMessage::new(
                    "bibleImport.psalmTitlesInVerse",
                    "Where the Hebrew text writes a Psalm's title as the start of verse 1, these files do not mark where the title ends, so it stays part of verse 1.",
                ),
            );
        }
    }

    /// Whether the placed text refused Joel 4, a chapter only Hebrew
    /// numbering has.
    fn uses_hebrew_numbering(&self) -> bool {
        self.issues.iter().any(is_hebrew_chapter)
    }

    /// Whether the held verses use Hebrew numbering: Joel with a fourth
    /// chapter, or Malachi 3 beyond its 18 English verses.
    fn held_is_hebrew_numbered_in(&self, held: &[HeldVerse], map: &VerseMap) -> bool {
        // The Open Scriptures Hebrew Bible is the Westminster Leningrad Codex,
        // in its Hebrew numbering, whatever books were chosen.
        if self
            .declared_grammar
            .as_ref()
            .is_some_and(|(scheme, _)| *scheme == grammar_oshb())
        {
            return true;
        }
        held.iter().any(|v| {
            let Ok(chapter) = v.chapter.parse::<u16>() else {
                return false;
            };
            let Some(book) = canon::by_ordinal(v.ordinal) else {
                return false;
            };
            let verse = v.label.parse::<u16>().unwrap_or(0);
            // A chapter or verse only the Hebrew numbering has, at a place the map names.
            chapter > book.chapter_count
                || (map.to_english.contains_key(&(v.ordinal, chapter, verse))
                    && canon::verse_count(book, chapter).is_some_and(|count| verse > count))
        })
    }

    /// Structure checks that need the whole book: missing chapters and
    /// gaps in verse numbering.
    pub(super) fn check_structure(&mut self) {
        let mut found = Vec::new();
        for (ordinal, content) in &self.books {
            let Some(book) = canon::by_ordinal(*ordinal) else {
                continue;
            };
            let chapters: BTreeSet<u16> = content.chapters.keys().copied().collect();
            let missing: Vec<u16> = (1..=book.chapter_count)
                .filter(|c| !chapters.contains(c))
                .collect();
            if !missing.is_empty() && !chapters.is_empty() {
                found.push((
                    Severity::Warning,
                    book,
                    None,
                    with_list(
                        UserMessage::new(
                            "bibleImport.missingChapters",
                            format!(
                                "{}: {} of {} chapters found (missing: {}).",
                                book.name,
                                chapters.len(),
                                book.chapter_count,
                                list(&missing)
                            ),
                        )
                        .with("bookCode", book.code)
                        .with("found", chapters.len())
                        .with("count", book.chapter_count),
                        &missing,
                    ),
                ));
            }
            for (chapter, text) in &content.chapters {
                let Some(max) = text.verses.keys().max().copied() else {
                    found.push((
                        Severity::Warning,
                        book,
                        Some(*chapter),
                        UserMessage::new(
                            "bibleImport.noVerses",
                            format!("{} {chapter}: no verses were found.", book.name),
                        )
                        .with("bookCode", book.code)
                        .with("chapter", chapter),
                    ));
                    continue;
                };
                // Verses covered by a bridge ("4-5") are not missing.
                let gaps: Vec<u16> = (1..max).filter(|v| !text.verses.contains_key(v)).collect();
                if !gaps.is_empty() {
                    found.push((
                        Severity::Warning,
                        book,
                        Some(*chapter),
                        with_list(
                            UserMessage::new(
                                "bibleImport.missingVerses",
                                format!(
                                    "{} {chapter}: verse{} {} not found. The expected verse structure differs from this text.",
                                    book.name,
                                    if gaps.len() == 1 { "" } else { "s" },
                                    list(&gaps)
                                ),
                            )
                            .with("bookCode", book.code)
                            .with("chapter", chapter),
                            &gaps,
                        ),
                    ));
                }
            }
        }
        for (severity, book, chapter, message) in found {
            self.issue(severity, Some(book), chapter, message);
        }
        // Bridged verses leave a deliberate gap; drop the matching warning.
        let bridges: Vec<(Option<&str>, Option<u16>)> = self
            .issues
            .iter()
            .filter(|i| i.code.as_deref() == Some("bibleImport.bridged"))
            .map(|i| (i.book, i.chapter))
            .collect();
        self.issues.retain(|i| {
            !(i.code.as_deref() == Some("bibleImport.missingVerses")
                && bridges.contains(&(i.book, i.chapter)))
        });
        self.issues.sort_by_key(|i| i.severity);
    }

    /// Decides whether the annotated words are indexed, and how their
    /// morphology codes are read (v0.21). Words that are not indexed are
    /// dropped here; the report still says what was found.
    pub fn finish_words(&mut self) {
        let mut kept = 0usize;
        let mut verses = 0usize;
        let (mut lemma, mut ids, mut morph) = (0usize, 0usize, 0usize);
        let (mut phrases, mut parts) = (0usize, 0usize);
        let mut codes: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut lemmas: BTreeSet<&str> = BTreeSet::new();
        for book in self.books.values() {
            for chapter in book.chapters.values() {
                for list in chapter.words.values() {
                    verses += 1;
                    for w in list {
                        kept += 1;
                        if let Some(l) = &w.lemma {
                            lemma += 1;
                            lemmas.insert(l);
                        }
                        ids += usize::from(w.strong.is_some());
                        match w.shape {
                            WordShape::Phrase => phrases += 1,
                            WordShape::Part => parts += 1,
                            WordShape::Word => {}
                        }
                        if let Some(code) = &w.morph {
                            morph += 1;
                            *codes.entry(code.trim().to_string()).or_default() += 1;
                        }
                    }
                }
            }
        }
        let distinct = lemmas.len();
        let report = &mut self.words.report;
        report.words = kept;
        report.verses = verses;
        report.with_lemma = lemma;
        report.with_lexical_id = ids;
        report.with_morphology = morph;
        report.distinct_lemmas = distinct;
        report.phrases = phrases;
        report.parts = parts;
        report.morph_attribute = match self.words.morph_attributes.len() {
            0 => None,
            1 => self
                .words
                .morph_attributes
                .iter()
                .next()
                .map(|s| s.to_string()),
            _ => Some("x-morph, morph".into()),
        };
        // Which scheme the codes fit, and whether the edition says so (v0.22).
        report.grammar = grammar::identify(&codes, &self.notes, self.declared_grammar.clone());
        let left = report.left_out.total();
        report.not_indexed = if kept == 0 && report.marked == 0 {
            None
        } else if self.words.unreadable {
            Some("unreadable")
        } else if kept > WORDS_MAX {
            Some("tooLarge")
        } else if left > 10 && left * 100 > report.marked {
            // A partly read index would look authoritative while being wrong.
            Some("unreliable")
        } else if kept > 0 && lemma == 0 && morph == 0 {
            // Lexical numbers on a translation's words: reported, not indexed (yet).
            Some("strongOnly")
        } else {
            None
        };
        report.indexed = kept > 0 && report.not_indexed.is_none();
        report.estimated_bytes = kept * BYTES_PER_WORD;
        // Lexical numbers alone are kept: the person may ask for them (v0.22).
        if !report.indexed && report.not_indexed != Some("strongOnly") {
            for book in self.books.values_mut() {
                for chapter in book.chapters.values_mut() {
                    chapter.words.clear();
                }
            }
        }
    }

    pub fn has_errors(&self) -> bool {
        self.issues.iter().any(|i| i.severity == Severity::Error)
    }

    pub fn verse_count(&self) -> usize {
        self.books
            .values()
            .flat_map(|b| b.chapters.values())
            .map(|c| c.verses.len())
            .sum()
    }

    pub fn chapter_count(&self) -> usize {
        self.books.values().map(|b| b.chapters.len()).sum()
    }
}

/// A verse as a canonical reference ("ISA.63.19").
fn canonical(ordinal: u8, chapter: u16, verse: u16) -> Option<String> {
    canon::by_ordinal(ordinal).map(|b| format!("{}.{chapter}.{verse}", b.code))
}

/// Joins a verse onto the verse already at (chapter, verse): its text after a
/// space, its words after the text (v0.22, versification).
fn join(content: &mut StagedBook, chapter: u16, verse: u16, text: String, words: Vec<StagedWord>) {
    let chapter = content.chapters.entry(chapter).or_default();
    let before = chapter.verses.entry(verse).or_default();
    let shift = before.encode_utf16().count() + usize::from(!before.is_empty());
    if !before.is_empty() {
        before.push(' ');
    }
    before.push_str(&text);
    if !words.is_empty() {
        let list = chapter.words.entry(verse).or_default();
        list.extend(words.into_iter().map(|mut w| {
            w.start += shift;
            w.end += shift;
            w
        }));
    }
}

/// Adds a number list for the interface: `numbers` (the first few,
/// comma-separated), `listed` (how many are shown) and `more` (how many
/// are left out).
fn with_list(message: UserMessage, numbers: &[u16]) -> UserMessage {
    let shown = numbers.len().min(LIST_SHOWN);
    message
        .with(
            "numbers",
            numbers[..shown]
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(", "),
        )
        .with("listed", numbers.len())
        .with("more", numbers.len() - shown)
}

const LIST_SHOWN: usize = 8;

fn list(numbers: &[u16]) -> String {
    let mut text = numbers
        .iter()
        .take(LIST_SHOWN)
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    if numbers.len() > LIST_SHOWN {
        text.push_str(&format!(" and {} more", numbers.len() - LIST_SHOWN));
    }
    text
}

/// Where the files came from; decides how the source is kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportOrigin {
    /// Shipped with Abiding Word (`id` from [`crate::scripture::bundled`]).
    Bundled { id: &'static str },
    /// Chosen by the user; copied into the data folder on commit.
    UserFiles,
    /// The kept source of a Bible already added, read again for its words
    /// (v0.22); committed only as a word index, never as a new Bible.
    Existing { translation_id: String },
}

/// A parsed, validated import waiting for the user's decision.
pub struct StagedImport {
    pub id: String,
    pub origin: ImportOrigin,
    pub files: Vec<PathBuf>,
    pub format: &'static str,
    pub content: StagedContent,
    pub suggested_name: String,
    /// The language the files' own metadata states (Digital Bible Library
    /// `metadata.xml`, Paratext `Settings.xml`), as a well-formed tag; never
    /// guessed from names or text.
    pub language_tag: Option<String>,
    /// A Bible read from documents (v0.23): the files, and what was found in them.
    pub documents: Option<DocumentStage>,
}

/// A Bible read from PDF, EPUB, DOCX, Markdown or text files (v0.23): the
/// documents as the library's adapters read them, and the books, chapters
/// and verses found in them (`scripture::structure`). The verses themselves
/// are the import's `content`.
pub struct DocumentStage {
    pub files: Vec<documents::DocumentFile>,
    /// The language the documents were read in (from their metadata).
    pub language: Option<String>,
    pub corrections: structure::Corrections,
    pub origins: BTreeMap<(u8, u16, u16), structure::Origin>,
    pub books: Vec<structure::FoundBook>,
    pub left_out: Vec<structure::LeftOut>,
    pub stats: structure::Stats,
}

impl DocumentStage {
    fn units(&self) -> Vec<documents::Unit> {
        self.files
            .iter()
            .flat_map(|f| f.units.iter().cloned())
            .collect()
    }
}

/// Metadata files read beside the USFM for the language they state.
fn is_metadata_file(name: &str) -> bool {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();
    base == "metadata.xml" || base == "settings.xml"
}

/// The language a Bible's own metadata states, when it is a well-formed tag
/// and all such files agree: DBL `metadata.xml` (`<language>` → `<bcp47>`,
/// `<ldml>` or `<iso>`) or Paratext `Settings.xml` (`<LanguageIsoCode>`). Only
/// these structured fields count; names, titles and text never do.
pub fn metadata_language(files: &[SourceText]) -> Option<String> {
    fn field<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
        let open = format!("<{tag}>");
        let start = text.find(&open)? + open.len();
        let end = start + text[start..].find('<')?;
        Some(text[start..end].trim())
    }
    /// The text without XML comments: a commented-out block states nothing.
    fn uncommented(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(at) = rest.find("<!--") {
            out.push_str(&rest[..at]);
            rest = rest[at..]
                .find("-->")
                .map_or("", |end| &rest[at + end + 3..]);
        }
        out.push_str(rest);
        out
    }
    let mut found: Vec<String> = Vec::new();
    for file in files.iter().filter(|f| is_metadata_file(&f.name)) {
        let text = uncommented(&file.text);
        let tag = if let Some(at) = text.find("<language>") {
            let block = &text[at..];
            let block = &block[..block.find("</language>").unwrap_or(block.len())];
            ["bcp47", "ldml", "iso"]
                .iter()
                .find_map(|t| field(block, t).and_then(crate::scripture::language::normalise_tag))
        } else {
            // Paratext writes "language:script:region:variant" ("sr:Latn:RS:").
            field(&text, "LanguageIsoCode")
                .map(|code| {
                    code.split(':')
                        .filter(|p| !p.is_empty())
                        .collect::<Vec<_>>()
                        .join("-")
                })
                .and_then(|tag| crate::scripture::language::normalise_tag(&tag))
        };
        if let Some(tag) = tag {
            found.push(tag);
        }
    }
    // Tags are normalised ("deu" → "de"), so the same language agrees.
    found.sort();
    found.dedup();
    match found.as_slice() {
        [one] => Some(one.clone()),
        // None, or files that disagree: no guess.
        _ => None,
    }
}

/// Reads the given files, detects the format and stages the content.
pub fn stage(paths: &[PathBuf], origin: ImportOrigin) -> AppResult<StagedImport> {
    if paths.is_empty() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "import.noFiles",
            "Choose at least one file.",
        )));
    }
    if is_document_choice(paths)? {
        return stage_documents(paths, origin);
    }
    let (texts, set_aside) = read_sources(paths)?;
    let language_tag = metadata_language(&texts);
    let mut content = StagedContent::default();
    // Shown with the files left out (another publisher's OSIS, USX…).
    content.skipped_files.extend(set_aside);
    let mut map_refused = None;
    let mut readable_texts = Vec::new();
    for text in texts {
        if is_metadata_file(&text.name) {
            continue;
        }
        if is_notes_file(&text.name) {
            content.notes.push((text.name, text.text));
            continue;
        }
        if versification::is_verse_map(&text.name, &text.text) {
            match versification::parse(&text.text) {
                Some(map) => content.verse_map = Some(map),
                None => map_refused = Some(text.name),
            }
            continue;
        }
        // Front matter (`\id FRT`) can say whose grammar codes the edition uses.
        if text.text.len() as u64 <= METADATA_MAX && is_front_matter(&text.text) {
            content.notes.push((text.name.clone(), text.text.clone()));
        }
        readable_texts.push(text);
    }
    let texts = readable_texts;
    let adapters: [&dyn BibleImportAdapter; 3] = [&UsfmAdapter, &OshbAdapter, &MorphGntAdapter];
    let adapter = adapters
        .into_iter()
        .find(|a| texts.iter().any(|t| a.can_read(t)))
        .ok_or_else(|| {
            AppError::UnsupportedFormat(UserMessage::new(
                "bibleImport.unknownFormat",
                "These files are not in a Bible format Abiding Word can read yet. \
                 It reads USFM Bibles (.usfm or .sfm files, or a .zip of them), the Open \
                 Scriptures Hebrew Bible's OSIS files and MorphGNT files.",
            ))
        })?;
    // Files of another format than the one chosen are named with the files left out.
    let (readable, other): (Vec<SourceText>, Vec<SourceText>) =
        texts.into_iter().partition(|t| adapter.can_read(t));
    content.skipped_files.extend(
        other
            .into_iter()
            .filter(|t| !is_front_matter(&t.text))
            .map(|t| t.name),
    );

    let had_map = content.verse_map.is_some();
    adapter.read(&readable, &mut content);
    content.release_held();
    if let Some(name) = map_refused {
        content.issue(
            Severity::Warning,
            None,
            None,
            UserMessage::new(
                "bibleImport.verseMapRefused",
                format!("The verse map “{name}” could not be read completely, so it was not used."),
            )
            .with("fileName", name),
        );
    }
    let oshb_text = content
        .declared_grammar
        .as_ref()
        .is_some_and(|(scheme, _)| *scheme == grammar_oshb());
    if !had_map && (content.uses_hebrew_numbering() || oshb_text) {
        content.issue(
            Severity::Note,
            None,
            None,
            UserMessage::new(
                "bibleImport.hebrewNumbering",
                "This text seems to use the Hebrew Bible's verse numbers (Joel has four chapters). \
                 Add the verse map that comes with it (for the Open Scriptures Hebrew Bible: \
                 wlc/VerseMap.xml) to the files chosen, and they will be renumbered.",
            ),
        );
    }
    content.check_structure();
    content.finish_words();
    if content.books.is_empty() && !content.has_errors() {
        return Err(AppError::Import(UserMessage::new(
            "bibleImport.noBooks",
            "No books of the Bible were found in these files.",
        )));
    }
    log::info!(
        "import staged: {} file(s), {} book(s), {} verse(s), {} issue(s)",
        paths.len(),
        content.books.len(),
        content.verse_count(),
        content.issues.len()
    );

    Ok(StagedImport {
        id: uuid::Uuid::new_v4().to_string(),
        origin,
        files: paths.to_vec(),
        format: adapter.format(),
        content,
        suggested_name: suggested_name(paths),
        language_tag,
        documents: None,
    })
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Whether the files chosen are documents to read as a Bible (v0.23): PDF,
/// EPUB, DOCX or Markdown files, or text files that are not in a Bible
/// format (USFM and MorphGNT files are `.txt` too). Documents and Bible-format
/// files chosen together are refused: they are not one edition.
fn is_document_choice(paths: &[PathBuf]) -> AppResult<bool> {
    let extensions: Vec<String> = paths.iter().map(|p| extension_of(p)).collect();
    let layout = |e: &str| matches!(e, "pdf" | "epub" | "docx" | "md" | "markdown");
    if extensions.iter().any(|e| layout(e)) {
        if extensions.iter().all(|e| layout(e) || e == "txt") {
            return Ok(true);
        }
        return Err(AppError::InvalidInput(UserMessage::new(
            "bibleImport.documentMixed",
            "Choose either the files of a Bible in a Bible format (such as USFM) or documents \
             (PDF, EPUB, Word, Markdown or text), not both together.",
        )));
    }
    if extensions.is_empty() || !extensions.iter().all(|e| e == "txt") {
        return Ok(false);
    }
    // Text files: a Bible format when any reader recognises them.
    let (texts, _) = read_sources(paths)?;
    let readers: [&dyn BibleImportAdapter; 3] = [&UsfmAdapter, &OshbAdapter, &MorphGntAdapter];
    let structured = texts.iter().any(|t| readers.iter().any(|r| r.can_read(t)));
    Ok(!structured)
}

/// File names in the order a person reads them: "Part 2" before "Part 10".
fn natural_key(name: &str) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut number: Option<u64> = None;
    for c in name.to_lowercase().chars() {
        if let Some(d) = c.to_digit(10) {
            number = Some(
                number
                    .unwrap_or(0)
                    .saturating_mul(10)
                    .saturating_add(u64::from(d)),
            );
        } else {
            if let Some(n) = number.take() {
                out.push((std::mem::take(&mut text), n));
            }
            text.push(c);
        }
    }
    out.push((text, number.unwrap_or(0)));
    out
}

/// Reads documents as a Bible (v0.23): each through the library's adapter,
/// then all of them for books, chapters and verses. Nothing is kept yet.
pub fn stage_documents(paths: &[PathBuf], origin: ImportOrigin) -> AppResult<StagedImport> {
    if paths.len() > documents::MAX_FILES {
        return Err(AppError::Import(UserMessage::new(
            "bibleImport.documentTooMany",
            "Too many documents were chosen to be one Bible.",
        )));
    }
    let mut ordered: Vec<PathBuf> = paths.to_vec();
    ordered.sort_by_key(|p| natural_key(&file_name(p)));
    let mut total = 0u64;
    let mut files = Vec::with_capacity(ordered.len());
    for (index, path) in ordered.iter().enumerate() {
        total += fs::metadata(path)
            .map_err(|e| AppError::filesystem(path, e))?
            .len();
        if total > documents::MAX_TOTAL_BYTES {
            return Err(AppError::Import(UserMessage::new(
                "bibleImport.tooLarge",
                "These files are too large to be a single Bible.",
            )));
        }
        files.push(documents::read(path, index as u16)?);
    }
    let formats: BTreeSet<&str> = files.iter().map(|f| f.format).collect();
    if formats.len() > 1 {
        return Err(AppError::InvalidInput(UserMessage::new(
            "bibleImport.documentFormats",
            "The documents of one Bible must all be of the same kind (all PDF, all EPUB …).",
        )));
    }
    let format = files[0].format;
    // The language the documents state (EPUB, PDF metadata), never guessed from the text.
    let stated: BTreeSet<String> = files
        .iter()
        .filter_map(|f| f.metadata.language.as_deref())
        .filter_map(crate::scripture::language::normalise_tag)
        .collect();
    let language = (stated.len() == 1)
        .then(|| stated.into_iter().next())
        .flatten();
    let mut stage = DocumentStage {
        files,
        language: language.clone(),
        corrections: structure::Corrections::default(),
        origins: BTreeMap::new(),
        books: Vec::new(),
        left_out: Vec::new(),
        stats: structure::Stats::default(),
    };
    let content = recognise(&mut stage);
    let name = stage
        .files
        .iter()
        .find_map(|f| f.metadata.title.clone())
        .unwrap_or_else(|| suggested_name(&ordered));
    log::info!(
        "document Bible staged: {} {} file(s), {} book(s), {} verse(s), {} issue(s)",
        stage.files.len(),
        format,
        content.books.len(),
        content.verse_count(),
        content.issues.len()
    );
    Ok(StagedImport {
        id: uuid::Uuid::new_v4().to_string(),
        origin,
        files: ordered,
        format,
        content,
        suggested_name: name,
        language_tag: language,
        documents: Some(stage),
    })
}

/// Reads the stage's documents for their verses, with its corrections.
fn recognise(stage: &mut DocumentStage) -> StagedContent {
    let units = stage.units();
    let found = structure::recognise(&units, stage.language.as_deref(), &stage.corrections);
    stage.origins = found.origins;
    stage.books = found.books;
    stage.left_out = found.left_out;
    stage.stats = found.stats;
    found.content
}

impl StagedImport {
    /// Reads the documents again with the person's corrections (v0.23):
    /// for each found book (by index), another book or none.
    pub fn correct(&mut self, books: &[(usize, Option<String>)]) -> AppResult<()> {
        let Some(stage) = self.documents.as_mut() else {
            return Err(AppError::InvalidInput(UserMessage::new(
                "import.expired",
                "This import has expired. Please choose the files again.",
            )));
        };
        let mut corrections = structure::Corrections::default();
        for (index, code) in books {
            if *index >= stage.books.len() {
                continue;
            }
            let book = match code {
                Some(code) => Some(canon::by_code(code).ok_or_else(|| {
                    AppError::InvalidInput(UserMessage::new(
                        "bibleImport.unknownBookCode",
                        "Unknown book.",
                    ))
                })?),
                None => None,
            };
            corrections.books.insert(*index, book);
        }
        stage.corrections = corrections;
        self.content = recognise(stage);
        Ok(())
    }
}

/// Files read only for what they say about the edition (v0.22): eBible's
/// `copr.htm`, a README or licence.
fn is_notes_file(name: &str) -> bool {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();
    let stem = base.split('.').next().unwrap_or("");
    let ext = base.rsplit('.').next().unwrap_or("");
    base.contains('.')
        && matches!(ext, "htm" | "html" | "txt" | "md")
        && matches!(
            stem,
            "copr" | "copyright" | "readme" | "license" | "licence"
        )
}

fn is_front_matter(text: &str) -> bool {
    let head = text.trim_start_matches('\u{feff}').trim_start();
    head.starts_with("\\id FRT") || head.starts_with("\\id INT")
}

fn grammar_oshb() -> &'static str {
    crate::scripture::morphology::OSHB
}

/// Whether the text says it was read with Hebrew verse numbers: Joel 4.
fn is_hebrew_chapter(issue: &ImportIssue) -> bool {
    issue.code.as_deref() == Some("bibleImport.chapterOutOfRange")
        && issue.book == Some("JOL")
        && issue.chapter == Some(4)
}

fn suggested_name(paths: &[PathBuf]) -> String {
    match paths {
        [single] => single
            .file_stem()
            .map(|s| s.to_string_lossy().replace(['_', '-'], " "))
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn unsupported(kind: &str) -> AppError {
    AppError::UnsupportedFormat(
        UserMessage::new(
            "bibleImport.formatNotYet",
            format!(
                "{kind} files can’t be imported as a structured Bible yet. Abiding Word reads \
                 USFM Bibles (.usfm or .sfm files, or a .zip of them), the Open Scriptures Hebrew \
                 Bible's OSIS files and MorphGNT files. A Bible can also be added from PDF, EPUB, \
                 Word (.docx), Markdown or text documents."
            ),
        )
        .with("format", kind),
    )
}

/// A metadata file larger than this is not read (bytes).
const METADATA_MAX: u64 = 1024 * 1024;

/// The files read, and the XML files set aside (not a format read here).
fn read_sources(paths: &[PathBuf]) -> AppResult<(Vec<SourceText>, Vec<String>)> {
    let mut total: u64 = 0;
    let mut texts = Vec::new();
    let mut set_aside: Vec<String> = Vec::new();
    for path in paths {
        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        match extension.as_str() {
            "pdf" => return Err(unsupported("PDF")),
            "epub" => return Err(unsupported("EPUB")),
            "doc" | "docx" | "odt" | "rtf" => return Err(unsupported("Word")),
            "html" | "htm" if is_notes_file(&file_name(path)) => {}
            "html" | "htm" | "xhtml" => return Err(unsupported("Web page")),
            "xml" | "osis" | "usx" => {}
            _ => {}
        }
        let size = fs::metadata(path)
            .map_err(|e| AppError::filesystem(path, e))?
            .len();
        if matches!(extension.as_str(), "xml" | "osis" | "usx")
            && !is_metadata_file(&file_name(path))
        {
            // Only OSHB's OSIS and its verse map are read; other XML is refused.
            if size > MAX_TOTAL_BYTES {
                return Err(unsupported("OSIS and USX"));
            }
            let bytes = fs::read(path).map_err(|e| AppError::filesystem(path, e))?;
            let text = decode(&bytes, &file_name(path))?;
            let name = file_name(path);
            if !(oshb::is_oshb(&text) || versification::is_verse_map(&name, &text)) {
                // Other XML beside readable files is set aside; alone, it is refused.
                set_aside.push(name);
                continue;
            }
            total += size;
            if total > MAX_TOTAL_BYTES {
                return Err(AppError::Import(UserMessage::new(
                    "bibleImport.tooLarge",
                    "These files are too large to be a single Bible.",
                )));
            }
            texts.push(SourceText { name, text });
            continue;
        }
        if is_metadata_file(&file_name(path)) || is_notes_file(&file_name(path)) {
            // Optional, as inside an archive: too large or unreadable is no language.
            if size <= METADATA_MAX {
                if let Ok(Ok(text)) = fs::read(path).map(String::from_utf8) {
                    texts.push(SourceText {
                        name: file_name(path),
                        text,
                    });
                }
            }
            continue;
        }
        total += size;
        if total > MAX_TOTAL_BYTES {
            return Err(AppError::Import(UserMessage::new(
                "bibleImport.tooLarge",
                "These files are too large to be a single Bible.",
            )));
        }
        if extension == "zip" {
            texts.extend(read_zip(path, &mut total)?);
        } else {
            let bytes = fs::read(path).map_err(|e| AppError::filesystem(path, e))?;
            texts.push(SourceText {
                name: file_name(path),
                text: decode(&bytes, &file_name(path))?,
            });
        }
    }
    if !set_aside.is_empty()
        && !texts
            .iter()
            .any(|t| !is_metadata_file(&t.name) && !is_notes_file(&t.name))
    {
        return Err(unsupported("OSIS and USX"));
    }
    Ok((texts, set_aside))
}

fn read_zip(path: &Path, total: &mut u64) -> AppResult<Vec<SourceText>> {
    let file = fs::File::open(path).map_err(|e| AppError::filesystem(path, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AppError::Import(
            UserMessage::new(
                "bibleImport.badZip",
                format!(
                    "The file “{}” is not a readable .zip archive ({e}).",
                    file_name(path)
                ),
            )
            .with("fileName", file_name(path)),
        )
    })?;
    let mut texts = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| {
            AppError::Import(
                UserMessage::new(
                    "bibleImport.badZipPart",
                    format!("Part of “{}” could not be read ({e}).", file_name(path)),
                )
                .with("fileName", file_name(path)),
            )
        })?;
        let name = entry.name().to_string();
        let lower = name.to_ascii_lowercase();
        // Metadata and notes are optional: too large or unreadable, they are skipped.
        let metadata = is_metadata_file(&lower) || is_notes_file(&lower);
        if entry.is_dir()
            || !(lower.ends_with(".usfm")
                || lower.ends_with(".sfm")
                || lower.ends_with(".ptx")
                || lower.ends_with(".xml")
                || lower.ends_with(".txt")
                || metadata)
            || (metadata && entry.size() > METADATA_MAX)
        {
            continue;
        }
        *total += entry.size();
        if *total > MAX_TOTAL_BYTES {
            return Err(AppError::Import(UserMessage::new(
                "bibleImport.zipTooLarge",
                "This archive is too large to be a single Bible.",
            )));
        }
        // Never more than the entry says it holds (a compressed entry can lie).
        let declared = entry.size();
        let mut bytes = Vec::new();
        let read = (&mut entry)
            .take(declared + 1)
            .read_to_end(&mut bytes)
            .and_then(|n| {
                if n as u64 > declared {
                    Err(std::io::Error::other("larger than it says"))
                } else {
                    Ok(n)
                }
            });
        if metadata && read.is_err() {
            continue;
        }
        read.map_err(|e| {
            AppError::Import(
                UserMessage::new(
                    "bibleImport.badZipEntry",
                    format!("“{name}” inside the archive could not be read ({e})."),
                )
                .with("fileName", &name),
            )
        })?;
        if metadata {
            // Optional: unreadable metadata is no language, never a failed import.
            if let Ok(text) = String::from_utf8(bytes) {
                texts.push(SourceText { text, name });
            }
            continue;
        }
        if lower.ends_with(".xml") || lower.ends_with(".txt") {
            // Read only if an adapter recognises it; other files in the archive are ignored.
            if let Ok(text) = String::from_utf8(bytes) {
                texts.push(SourceText { text, name });
            }
            continue;
        }
        texts.push(SourceText {
            text: decode(&bytes, &name)?,
            name,
        });
    }
    Ok(texts)
}

fn decode(bytes: &[u8], name: &str) -> AppResult<String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        AppError::Import(
            UserMessage::new(
                "library.notUtf8",
                format!("“{name}” is not saved as UTF-8 text, so it could not be read."),
            )
            .with("fileName", name),
        )
    })
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// What the verification screen shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub preview_id: String,
    pub format: &'static str,
    pub bundled: bool,
    pub suggested: SuggestedMetadata,
    pub book_count: usize,
    pub chapter_count: usize,
    pub verse_count: usize,
    pub books: Vec<PreviewBook>,
    pub issues: Vec<ImportIssue>,
    /// Files set aside because they are not one of the 66 books
    /// (introductions, glossaries, deuterocanonical books).
    pub skipped_files: Vec<String>,
    pub can_import: bool,
    /// The word annotations found (v0.21).
    pub words: WordReport,
    /// For documents (v0.23): what each file holds, and the verses found.
    pub document: Option<DocumentPreview>,
}

/// What the review shows of a Bible read from documents (v0.23).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPreview {
    pub files: Vec<DocumentFileInfo>,
    /// The book headings found, with what was read under each.
    pub books: Vec<structure::FoundBook>,
    /// Samples of text that belongs to no verse.
    pub left_out: Vec<structure::LeftOut>,
    pub stats: structure::Stats,
    /// Whether the verses found can be used: some were found and nothing
    /// contradicts itself. Otherwise the Bible can only be read as a document.
    pub verses_usable: bool,
    /// Characters of readable text in all the files.
    pub text_chars: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFileInfo {
    pub name: String,
    pub format: &'static str,
    pub pages: Option<u32>,
    pub text_chars: usize,
    /// No text layer (scanned pages): readable page by page only.
    pub scanned: bool,
    /// Its layout is kept and shown (PDF pages, EPUB and DOCX formatting).
    pub keeps_layout: bool,
    /// Footnotes and endnotes kept apart from the text.
    pub notes: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedMetadata {
    pub name: String,
    pub short_name: String,
    pub language: String,
    pub language_code: String,
    pub publisher: Option<String>,
    pub copyright_notice: Option<String>,
    pub license_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBook {
    pub code: &'static str,
    pub name: &'static str,
    pub chapters: usize,
    pub verses: usize,
    /// "ok", "warning" or "error".
    pub status: &'static str,
}

impl StagedImport {
    pub fn preview(&self, mut suggested: SuggestedMetadata) -> ImportPreview {
        // What the files themselves state (v0.22), when nothing better is known.
        if let Some(name) = &self.content.hints.name {
            if suggested.name.trim().is_empty() || self.files.len() > 1 {
                suggested.name = name.clone();
            }
        }
        if suggested.license_type.is_none() && suggested.copyright_notice.is_none() {
            suggested.copyright_notice = self.content.hints.license.clone();
        }
        if suggested.language_code.is_empty() {
            if let Some(tag) = &self.language_tag {
                suggested.language_code = tag.clone();
            }
        }
        let books = self
            .content
            .books
            .iter()
            .filter_map(|(ordinal, content)| {
                let book = canon::by_ordinal(*ordinal)?;
                let worst = self
                    .content
                    .issues
                    .iter()
                    .filter(|i| i.book == Some(book.code))
                    .map(|i| i.severity)
                    .min();
                Some(PreviewBook {
                    code: book.code,
                    name: book.name,
                    chapters: content.chapters.len(),
                    verses: content.chapters.values().map(|c| c.verses.len()).sum(),
                    status: match worst {
                        Some(Severity::Error) => "error",
                        Some(Severity::Warning) => "warning",
                        _ => "ok",
                    },
                })
            })
            .collect();
        ImportPreview {
            preview_id: self.id.clone(),
            format: self.format,
            bundled: matches!(self.origin, ImportOrigin::Bundled { .. }),
            suggested,
            book_count: self.content.books.len(),
            chapter_count: self.content.chapter_count(),
            verse_count: self.content.verse_count(),
            books,
            issues: self.content.issues.clone(),
            skipped_files: self.content.skipped_files.clone(),
            // A document can always be added, to read as a document.
            can_import: self.documents.is_some() || !self.content.has_errors(),
            words: self.content.words.report.clone(),
            document: self.documents.as_ref().map(|stage| DocumentPreview {
                files: stage
                    .files
                    .iter()
                    .map(|f| DocumentFileInfo {
                        name: f.file_name.clone(),
                        format: f.format,
                        pages: f.page_count,
                        text_chars: f.text_chars(),
                        scanned: f.extraction_status
                            == crate::library::adapters::ExtractionStatus::OcrRequired,
                        keeps_layout: f.keeps_layout(),
                        notes: f.notes,
                    })
                    .collect(),
                books: stage.books.clone(),
                left_out: stage.left_out.clone(),
                stats: stage.stats.clone(),
                verses_usable: self.content.verse_count() > 0 && !self.content.has_errors(),
                text_chars: stage.files.iter().map(|f| f.text_chars()).sum(),
            }),
        }
    }
}
