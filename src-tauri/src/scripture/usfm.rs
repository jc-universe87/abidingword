//! A USFM reader: turns one USFM book file into plain verse text.
//!
//! USFM (Unified Standard Format Markers, https://ubsicap.github.io/usfm/)
//! is a line-oriented text format with backslash markers: `\id JHN`,
//! `\c 15`, `\v 7 …`. The reader keeps the words of the text and drops
//! everything that is not verse text: footnotes and cross-references,
//! headings, introductions and titles. Psalm titles (`\d`) are kept
//! separately as superscriptions.
//!
//! Word-level markup (v0.21): `\w …\w*` and nested `\+w …\+w*` are
//! removed from the text as before, and each marked word is also reported
//! with its raw attribute list and its exact place in the verse text as
//! stored (UTF-16 offsets, after white space is collapsed). The text itself is
//! exactly what v0.20 read (a test compares it with that reader). Attributes
//! are only located here; `scripture::words` reads them.
//!
//! Paragraph and poetry line breaks are flattened to spaces in v0.2.
//! Validation (does the book exist, are verses duplicated…) happens later,
//! in the import staging step; this module only reports what it read.

use std::sync::OnceLock;

use regex::Regex;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct UsfmDocument {
    /// The book code from `\id`, upper case, if present.
    pub book_code: Option<String>,
    pub verses: Vec<RawVerse>,
    pub superscriptions: Vec<(String, String)>,
    /// Verse markers found before any chapter marker.
    pub verses_outside_chapter: usize,
    /// Markers this reader does not know; ignored, reported for the log.
    pub unknown_markers: Vec<String>,
    /// Word markup that could not be read safely (v0.21).
    pub word_problems: WordProblems,
}

/// Word markup that could not be tied to words of a verse (v0.21). Every
/// such word is left out of the word index; the verse text is unaffected.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct WordProblems {
    /// `\w` opened and never closed within its verse.
    pub unclosed: usize,
    /// `\w*` with no `\w` open.
    pub stray_close: usize,
    /// An attribute list that belongs to no open word.
    pub orphan_attributes: usize,
    /// Marked words that overlap another marked word.
    pub overlapping: usize,
    /// Marked words with attributes outside verse text (headings, titles).
    pub outside_verse: usize,
    /// Marked "words" with no letters (punctuation only).
    pub empty: usize,
    /// In a verse with more marked spans than any real verse has.
    pub too_many: usize,
    /// The file uses the reader's internal placeholder characters, so its
    /// word markup is not read at all.
    pub unreadable: bool,
}

impl WordProblems {
    /// Annotated words lost to these problems. Markup without attributes
    /// (a stray `\w*`, an unclosed glossary word) annotates nothing, so it is
    /// not counted.
    pub fn total(&self) -> usize {
        self.unclosed
            + self.orphan_attributes
            + self.overlapping
            + self.outside_verse
            + self.empty
            + self.too_many
    }
}

/// How a marked span lies over the verse's words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WordShape {
    /// Exactly one word of the text.
    Word,
    /// Several whole words (a multi-word unit).
    Phrase,
    /// Part of a written word (a prefix, a clitic, a contraction).
    Part,
}

impl WordShape {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Word => "word",
            Self::Phrase => "phrase",
            Self::Part => "part",
        }
    }
}

/// A word marked with `\w`, where it is in the verse text as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkedWord {
    /// UTF-16 offsets into the verse text, end exclusive, around the letters
    /// of the marked span (surrounding punctuation excluded).
    pub start: usize,
    pub end: usize,
    /// The text at those offsets.
    pub surface: String,
    pub shape: WordShape,
    /// The raw attribute list after `|`, if any.
    pub attributes: Option<String>,
}

/// A verse exactly as read: numbers as written, text cleaned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawVerse {
    pub chapter: String,
    pub label: String,
    pub text: String,
    /// Marked words in `text`, in order (v0.21).
    pub words: Vec<MarkedWord>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    Nothing,
    Verse,
    Superscription,
}

/// Placeholders the reader puts where a word's attribute list was, so the
/// list can be given to its word: `OPEN` index `CLOSE`. Unicode
/// noncharacters, never part of real text; a file that has them anyway has
/// its word markup ignored (`WordProblems::unreadable`).
const OPEN: char = '\u{FDD0}';
const CLOSE: char = '\u{FDD1}';

fn regexes() -> &'static (Regex, Regex, Regex) {
    static RE: OnceLock<(Regex, Regex, Regex)> = OnceLock::new();
    RE.get_or_init(|| {
        (
            // Footnotes, endnotes and cross-references, with their content.
            Regex::new(r"(?s)\\(f|fe|ef|x|ex)\s.*?\\(f|fe|ef|x|ex)\*").unwrap(),
            // Attributes: `\w word|strong="G1"\w*` keeps only `word`. A
            // backslash inside the list escapes the next character (`\"`,
            // `\\`, `\|`) unless it begins a marker.
            Regex::new(r"\|((?:[^\\|]|\\[^a-z+*\s])*)(\\\+?[a-z]+[0-9]*\*)").unwrap(),
            // A marker. An opening marker swallows one following space.
            Regex::new(r"\\\+?([a-z]+[0-9]*)(?:(\*)|[ \t\r\n]?)").unwrap(),
        )
    })
}

fn is_paragraph(name: &str) -> bool {
    let base = name.trim_end_matches(|c: char| c.is_ascii_digit());
    matches!(
        base,
        "p" | "m"
            | "po"
            | "pr"
            | "cls"
            | "pmo"
            | "pm"
            | "pmc"
            | "pmr"
            | "pi"
            | "mi"
            | "nb"
            | "pc"
            | "ph"
            | "b"
            | "q"
            | "qr"
            | "qc"
            | "qa"
            | "qm"
            | "qd"
            | "lh"
            | "li"
            | "lf"
            | "lim"
            | "tr"
            | "tc"
            | "th"
            | "tcr"
            | "thr"
    )
}

/// Markers whose following text (up to the next marker) is not verse text.
fn is_skipped_paragraph(name: &str) -> bool {
    let base = name.trim_end_matches(|c: char| c.is_ascii_digit());
    matches!(
        base,
        "ide"
            | "h"
            | "toc"
            | "toca"
            | "mt"
            | "mte"
            | "ms"
            | "mr"
            | "s"
            | "sr"
            | "r"
            | "sp"
            | "sd"
            | "cl"
            | "cp"
            | "cd"
            | "rem"
            | "sts"
            | "restore"
            | "periph"
            | "lit"
            | "usfm"
    ) || (base.starts_with('i') && base != "it")
}

/// Character markers whose content is dropped (alternate numbering, figures,
/// inline reference quotations).
fn is_skipped_character(name: &str) -> bool {
    matches!(name, "ca" | "va" | "vp" | "fig" | "rq" | "cat")
}

fn is_known_character(name: &str) -> bool {
    matches!(
        name,
        "w" | "wj"
            | "add"
            | "nd"
            | "qs"
            | "qac"
            | "k"
            | "bk"
            | "tl"
            | "pn"
            | "png"
            | "sc"
            | "it"
            | "bd"
            | "em"
            | "bdit"
            | "no"
            | "sup"
            | "wh"
            | "wg"
            | "wa"
            | "ord"
            | "qt"
            | "sig"
            | "sls"
            | "dc"
            | "rb"
            | "pro"
            | "jmp"
            | "addpn"
            | "lik"
            | "liv"
            | "litl"
    )
}

/// A `\w` waiting for its `\w*`: where its text began in the verse being
/// read (`None` when it opened outside verse text), and its attribute list.
struct OpenWord {
    start: Option<usize>,
    attributes: Option<usize>,
}

/// A marked span of a verse as read: bytes of the uncollapsed text.
struct Span {
    start: usize,
    end: usize,
    attributes: Option<usize>,
}

/// The verse being read and the words marked in it.
#[derive(Default)]
struct Reading {
    current: Option<RawVerse>,
    spans: Vec<Span>,
    open: Vec<OpenWord>,
}

impl Reading {
    /// Ends the verse: its text collapsed, its words placed in that text.
    fn finish(&mut self, doc: &mut UsfmDocument, attributes: &[String]) {
        for word in self.open.drain(..) {
            if word.start.is_some() && word.attributes.is_some() {
                doc.word_problems.unclosed += 1;
            }
        }
        let spans = std::mem::take(&mut self.spans);
        if let Some(mut verse) = self.current.take() {
            let (text, words) =
                place_words(&verse.text, &spans, attributes, &mut doc.word_problems);
            verse.text = text;
            verse.words = words;
            doc.verses.push(verse);
        }
    }
}

pub fn parse(source: &str) -> UsfmDocument {
    let (notes, attribute_list, marker) = regexes();
    let without_notes = notes.replace_all(source, " ");
    let mut doc = UsfmDocument::default();
    // Each `\w` attribute list is set aside and a placeholder left in its place.
    let readable = !source.contains(OPEN) && !source.contains(CLOSE);
    doc.word_problems.unreadable = !readable;
    let mut attributes: Vec<String> = Vec::new();
    let cleaned = attribute_list.replace_all(&without_notes, |caps: &regex::Captures| {
        let closing = &caps[2];
        if readable && (closing == "\\w*" || closing == "\\+w*") {
            attributes.push(caps[1].to_string());
            format!("{OPEN}{}{CLOSE}{closing}", attributes.len() - 1)
        } else {
            closing.to_string()
        }
    });

    let mut chapter: Option<String> = None;
    let mut reading = Reading::default();
    let mut superscription = String::new();
    let mut target = Target::Nothing;
    let mut skip_depth: Vec<String> = Vec::new();
    // What the next text segment is: normal content, or a number/code.
    let mut expect: Option<&'static str> = None;

    let finish_superscription =
        |doc: &mut UsfmDocument, chapter: &Option<String>, text: &mut String| {
            let text_now = collapse(text);
            if let (Some(c), false) = (chapter, text_now.is_empty()) {
                doc.superscriptions.push((c.clone(), text_now));
            }
            text.clear();
        };

    let mut position = 0;
    let mut segments: Vec<(Option<(String, bool)>, &str)> = Vec::new();
    for caps in marker.captures_iter(&cleaned) {
        let whole = caps.get(0).unwrap();
        segments.push((None, &cleaned[position..whole.start()]));
        segments.push((Some((caps[1].to_string(), caps.get(2).is_some())), ""));
        position = whole.end();
    }
    segments.push((None, &cleaned[position..]));

    for (marker, text) in segments {
        match marker {
            None => {
                // Placeholders go to the innermost open word; the text is read without them.
                let owned;
                let mut text = if text.contains(OPEN) {
                    owned = take_placeholders(text, &mut reading.open, &mut doc.word_problems);
                    owned.as_str()
                } else {
                    text
                };
                if let Some(kind) = expect.take() {
                    let trimmed = text.trim_start();
                    let (first, rest) = trimmed
                        .split_once(char::is_whitespace)
                        .unwrap_or((trimmed, ""));
                    match kind {
                        "id" => {
                            doc.book_code = Some(first.to_ascii_uppercase());
                            text = "";
                        }
                        "c" => {
                            chapter = Some(first.to_string());
                            text = "";
                        }
                        _ => {
                            // "v": the verse label, then verse text.
                            match &chapter {
                                Some(c) => {
                                    reading.current = Some(RawVerse {
                                        chapter: c.clone(),
                                        label: first.to_string(),
                                        text: String::new(),
                                        words: Vec::new(),
                                    });
                                    target = Target::Verse;
                                }
                                None => doc.verses_outside_chapter += 1,
                            }
                            text = rest;
                        }
                    }
                }
                if !skip_depth.is_empty() {
                    continue;
                }
                match target {
                    Target::Verse => {
                        if let Some(verse) = reading.current.as_mut() {
                            verse.text.push_str(text);
                        }
                    }
                    Target::Superscription => superscription.push_str(text),
                    Target::Nothing => {}
                }
            }
            Some((name, closing)) => {
                if is_skipped_character(&name) {
                    if closing {
                        if skip_depth.last() == Some(&name) {
                            skip_depth.pop();
                        }
                    } else {
                        skip_depth.push(name);
                    }
                    continue;
                }
                if name == "w" {
                    if closing {
                        match reading.open.pop() {
                            Some(OpenWord {
                                start: Some(start),
                                attributes: list,
                            }) => {
                                if let Some(verse) = &reading.current {
                                    reading.spans.push(Span {
                                        start,
                                        end: verse.text.len(),
                                        attributes: list,
                                    });
                                }
                            }
                            Some(OpenWord {
                                start: None,
                                attributes: Some(_),
                            }) => doc.word_problems.outside_verse += 1,
                            Some(_) => {}
                            None => doc.word_problems.stray_close += 1,
                        }
                    } else {
                        let live = target == Target::Verse && skip_depth.is_empty();
                        reading.open.push(OpenWord {
                            start: reading
                                .current
                                .as_ref()
                                .filter(|_| live)
                                .map(|v| v.text.len()),
                            attributes: None,
                        });
                    }
                    continue;
                }
                if closing || is_known_character(&name) {
                    continue;
                }
                match name.as_str() {
                    "id" => {
                        reading.finish(&mut doc, &attributes);
                        expect = Some("id");
                        target = Target::Nothing;
                    }
                    "c" => {
                        reading.finish(&mut doc, &attributes);
                        finish_superscription(&mut doc, &chapter, &mut superscription);
                        expect = Some("c");
                        target = Target::Nothing;
                    }
                    "v" => {
                        reading.finish(&mut doc, &attributes);
                        finish_superscription(&mut doc, &chapter, &mut superscription);
                        expect = Some("v");
                    }
                    "d" => {
                        reading.finish(&mut doc, &attributes);
                        target = Target::Superscription;
                    }
                    other if is_paragraph(other) => {
                        if target == Target::Superscription {
                            finish_superscription(&mut doc, &chapter, &mut superscription);
                        }
                        target = if reading.current.is_some() {
                            if let Some(verse) = reading.current.as_mut() {
                                verse.text.push(' ');
                            }
                            Target::Verse
                        } else {
                            Target::Nothing
                        };
                    }
                    other if is_skipped_paragraph(other) => target = Target::Nothing,
                    other => {
                        if !doc.unknown_markers.iter().any(|m| m == other) {
                            doc.unknown_markers.push(other.to_string());
                        }
                    }
                }
            }
        }
    }
    reading.finish(&mut doc, &attributes);
    finish_superscription(&mut doc, &chapter, &mut superscription);
    doc
}

/// Removes the attribute placeholders from a text segment, giving each list
/// to the innermost open word that has none yet.
fn take_placeholders(text: &str, open: &mut [OpenWord], problems: &mut WordProblems) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(OPEN) {
        out.push_str(&rest[..at]);
        let after = &rest[at + OPEN.len_utf8()..];
        let Some(end) = after.find(CLOSE) else {
            rest = after;
            continue;
        };
        match (after[..end].parse::<usize>(), open.last_mut()) {
            (Ok(index), Some(word)) if word.attributes.is_none() => word.attributes = Some(index),
            _ => problems.orphan_attributes += 1,
        }
        rest = &after[end + CLOSE.len_utf8()..];
    }
    out.push_str(rest);
    out
}

/// The most marked spans placed in one verse; more cannot be real (the
/// longest verse has under 100 words) and are all left out.
pub const SPANS_PER_VERSE_MAX: usize = 1_000;

/// Joiners and the soft hyphen sit inside written words (Hebrew and Persian
/// editions use them); they belong to a marked word's letters here, and are
/// never treated as word characters by the surface concordance.
fn is_joiner(c: char) -> bool {
    matches!(c, '\u{2060}' | '\u{200C}' | '\u{200D}' | '\u{00AD}')
}

fn is_word_char(c: char) -> bool {
    crate::scripture::concordance::is_token_char(c) || is_joiner(c)
}

/// The verse text with white space collapsed (as v0.2 stores it), and each
/// marked span placed in it: UTF-16 offsets around its letters, its shape
/// against the verse's words. Spans that cannot be placed are counted (when
/// they carry attributes), not kept. Linear in the verse's length plus
/// n log n in its spans.
fn place_words(
    raw: &str,
    spans: &[Span],
    attributes: &[String],
    problems: &mut WordProblems,
) -> (String, Vec<MarkedWord>) {
    let text = collapse(raw);
    if spans.is_empty() {
        return (text, Vec::new());
    }
    let counted = |span: &Span| usize::from(span.attributes.is_some());
    if spans.len() > SPANS_PER_VERSE_MAX {
        problems.too_many += spans.iter().map(counted).sum::<usize>();
        return (text, Vec::new());
    }
    // Where each byte of the raw text went in the collapsed text.
    let mut map = vec![0usize; raw.len() + 1];
    let mut out_len = 0usize;
    let mut started = false;
    let mut pending = false;
    for (i, c) in raw.char_indices() {
        if c.is_whitespace() {
            pending = started;
            for slot in &mut map[i..i + c.len_utf8()] {
                *slot = out_len;
            }
            continue;
        }
        if pending {
            out_len += 1;
            pending = false;
        }
        started = true;
        for slot in &mut map[i..i + c.len_utf8()] {
            *slot = out_len;
        }
        out_len += c.len_utf8();
    }
    map[raw.len()] = out_len;
    // UTF-16 offset of each byte boundary of the collapsed text.
    let mut utf16 = vec![0usize; text.len() + 1];
    let mut units = 0usize;
    for (i, c) in text.char_indices() {
        utf16[i] = units;
        units += c.len_utf16();
    }
    utf16[text.len()] = units;
    let tokens = crate::scripture::concordance::tokens(&text);

    let mut placed: Vec<(MarkedWord, bool)> = Vec::new();
    for span in spans {
        let piece = &raw[span.start..span.end];
        // Only the letters: no surrounding spaces or punctuation.
        let Some(first) = piece.find(is_word_char) else {
            problems.empty += counted(span);
            continue;
        };
        let last = piece
            .char_indices()
            .rev()
            .find(|(_, c)| is_word_char(*c))
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(first);
        let from = map[span.start + first];
        let last_byte = span.start + last;
        let last_char = raw[..last_byte]
            .chars()
            .next_back()
            .map_or(0, char::len_utf8);
        let to = map[last_byte - last_char] + last_char;
        let (start, end) = (utf16[from], utf16[to]);
        let surface = text[from..to].to_string();
        // Tokens overlapping the span (tokens are in order and disjoint).
        let lo = tokens.partition_point(|t| t.end <= start);
        let hi = tokens.partition_point(|t| t.start < end);
        let aligned = lo < hi && tokens[lo].start == start && tokens[hi - 1].end == end;
        let shape = if !aligned {
            WordShape::Part
        } else if surface.contains(' ') {
            WordShape::Phrase
        } else {
            // One written word, joiners included.
            WordShape::Word
        };
        placed.push((
            MarkedWord {
                start,
                end,
                surface,
                shape,
                attributes: span.attributes.and_then(|i| attributes.get(i).cloned()),
            },
            span.attributes.is_some(),
        ));
    }
    // Spans close in reading order of their ends; the index is in reading order of starts.
    placed.sort_by_key(|(w, _)| (w.start, w.end));
    // A word inside another marked word cannot be highlighted on its own:
    // overlapping an earlier word (start before the furthest end so far) or
    // the next one (end after its start).
    let mut overlapped = vec![false; placed.len()];
    let mut furthest = 0usize;
    for i in 0..placed.len() {
        let (w, _) = &placed[i];
        if i > 0 && w.start < furthest {
            overlapped[i] = true;
        }
        if let Some((next, _)) = placed.get(i + 1) {
            if w.end > next.start {
                overlapped[i] = true;
            }
        }
        furthest = furthest.max(w.end);
    }
    let mut kept: Vec<MarkedWord> = Vec::with_capacity(placed.len());
    for ((word, has_attributes), bad) in placed.into_iter().zip(overlapped) {
        if bad {
            problems.overlapping += usize::from(has_attributes);
        } else {
            kept.push(word);
        }
    }
    (text, kept)
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_words_and_drops_markup() {
        let doc = parse(
            "\\id JHN 43-JHN-web.sfm Test\n\\h John\n\\mt1 John\n\\c 15\n\\p\n\
             \\v 1 \\wj “\\+w I|strong=\"G1473\"\\+w* \\+w am|strong=\"G1510\"\\+w* the true vine.\\f + \\fr 15:1 \\ft A note.\\f*\\wj*\n\
             \\v 2 doesn’\\+w t|strong=\"G3588\"\\+w* bear\\x - \\xo 15:2 \\xt Mat 3:10\\x* fruit.\n",
        );
        assert_eq!(doc.book_code.as_deref(), Some("JHN"));
        assert_eq!(doc.verses.len(), 2);
        assert_eq!(doc.verses[0].text, "“I am the true vine.");
        assert_eq!(doc.verses[1].text, "doesn’t bear fruit.");
        assert_eq!(doc.verses[1].chapter, "15");
        assert_eq!(doc.verses[1].label, "2");
    }

    #[test]
    fn verses_continue_across_paragraph_and_poetry_markers() {
        let doc = parse("\\id PSA\n\\c 23\n\\d A Psalm by David.\n\\q1\n\\v 1 The LORD is my shepherd;\n\\q2 I shall lack nothing.\n\\s1 Heading\n\\p\n\\v 2 He makes me lie down.");
        assert_eq!(
            doc.superscriptions,
            vec![("23".into(), "A Psalm by David.".into())]
        );
        assert_eq!(
            doc.verses[0].text,
            "The LORD is my shepherd; I shall lack nothing."
        );
        assert_eq!(doc.verses[1].text, "He makes me lie down.");
    }

    #[test]
    fn alternate_numbers_are_dropped_and_bridges_kept_as_labels() {
        let doc = parse("\\id ROM\n\\c 16\n\\v 25-27 \\va 25\\va* Now to him.");
        assert_eq!(doc.verses[0].label, "25-27");
        assert_eq!(doc.verses[0].text, "Now to him.");
    }

    #[test]
    fn verses_before_a_chapter_are_counted_not_kept() {
        let doc = parse("\\id ROM\n\\v 1 Stray.\n\\c 1\n\\v 1 Paul.");
        assert_eq!(doc.verses_outside_chapter, 1);
        assert_eq!(doc.verses.len(), 1);
    }
}
