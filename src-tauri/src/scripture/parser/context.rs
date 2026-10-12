//! Contextual references (v0.13.1): `15:4`, `15,4`, `15장 4절`, `v. 4`, written
//! without a book because the text has already named it.
//!
//! This is deterministic reference resolution, not inference: a bookless
//! reference takes its book (and, for verse-only shorthand, its chapter) only
//! from explicit references the source itself wrote nearby, and is left alone
//! whenever that context is missing or names more than one passage. Precision
//! over recall.
//!
//! The notation is the source language's own ([`Syntax`]), never a universal
//! one: English bookless references use `:` only (`.` is a decimal point), the
//! comma languages (DE, FR, ES, PT) `,` or `:` between digits, Korean `:` or
//! `N장 M절`. A semicolon separates references; it is never a chapter/verse
//! separator.
//!
//! Where context comes from, for one paragraph (see [`ContextTracker`] for how
//! a source's paragraphs are walked):
//!
//! 1. **A reference list:** a bookless reference straight after another
//!    reference, joined only by `;` (and, where `,` is not a verse separator, by
//!    `,`), continues it: `John 15:4; 15:7; 16:1`.
//! 2. **Otherwise** the books named by explicit references earlier in the same
//!    paragraph, in the paragraphs just before it (same section), and in the
//!    section's heading are gathered; exactly one book links, more than one does
//!    not.
//! 3. **Verse-only shorthand** (`v. 4`, `vv. 7–8`, `verse 5`, `V. 4`, `Vers 5`,
//!    `v. 4`/`verset`, `versículo`, `4절`) needs one book *and* one chapter from
//!    the same places: a passage within a single chapter.
//!
//! False positives are kept out by the shape of the text around a candidate:
//! part of a longer number (`3.14.15`, `2,5,7`), a leading zero (`1:05`), a time
//! or unit after it (`10:30 Uhr`, `1:30 pm`, `2,5 km`, `3,5 %`), a time word or
//! currency before it (`at 10:30`, `um 10:30`, `€ 2,50`), or a capitalised word
//! right before it that is not a known lead word (an unknown name such as
//! "Rom 4,3" in German, where "Rom" is the city).

use std::sync::OnceLock;

use regex::Regex;

use super::{utf16_offset, DetectedReference, Grammar, RawMatch, ReferenceParser};
use crate::scripture::canon::Book;
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::packs;
use crate::scripture::recognise::Recogniser;
use crate::scripture::reference::{Point, ScriptureRef};

/// Paragraphs after an explicit reference during which its book still counts
/// (within the same section), for sources divided into sections by headings.
pub const SECTION_LOOKBACK: usize = 8;
/// The same for sources without sections (PDF, plain text): the next couple of
/// paragraphs on the same page only.
pub const PAGE_LOOKBACK: usize = 2;

/// Context from outside the paragraph: what the section heading and the
/// paragraphs just before establish.
#[derive(Debug, Clone, Default)]
pub struct OuterContext {
    /// Books of explicit references in scope (deduplicated).
    pub books: Vec<&'static Book>,
    /// Passages in scope that lie within one chapter, as (book, chapter).
    pub chapters: Vec<(&'static Book, u16)>,
}

impl OuterContext {
    fn add(&mut self, reference: &ScriptureRef) {
        if !self.books.iter().any(|b| b.code == reference.book.code) {
            self.books.push(reference.book);
        }
        if reference.start.chapter == reference.end.chapter {
            let pair = (reference.book, reference.start.chapter);
            if !self
                .chapters
                .iter()
                .any(|(b, c)| b.code == pair.0.code && *c == pair.1)
            {
                self.chapters.push(pair);
            }
        }
    }

    fn merge(&mut self, other: &OuterContext) {
        for book in &other.books {
            if !self.books.iter().any(|b| b.code == book.code) {
                self.books.push(book);
            }
        }
        for pair in &other.chapters {
            if !self
                .chapters
                .iter()
                .any(|(b, c)| b.code == pair.0.code && *c == pair.1)
            {
                self.chapters.push(*pair);
            }
        }
    }
}

/// The references of one paragraph: those written with their book, and those
/// resolved from context.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParagraphReferences {
    pub explicit: Vec<DetectedReference>,
    pub contextual: Vec<DetectedReference>,
}

impl ParagraphReferences {
    /// All references in reading order.
    pub fn all(self) -> Vec<DetectedReference> {
        let mut all = self.explicit;
        all.extend(self.contextual);
        all.sort_by_key(|r| (r.start, r.end));
        all
    }
}

/// A bookless candidate as written.
#[derive(Debug, Clone)]
pub struct Candidate {
    /// Byte range in the text.
    pub start: usize,
    pub end: usize,
    pub kind: CandidateKind,
}

#[derive(Debug, Clone, Copy)]
pub enum CandidateKind {
    /// `15:4`, `15,5-6`, `15:26-16:4`, `15장 4절`.
    ChapterVerse {
        c1: u16,
        v1: u16,
        n2: Option<u16>,
        v2: Option<u16>,
    },
    /// `v. 4`, `vv. 7-8`, `4절`.
    VerseOnly { v1: u16, v2: Option<u16> },
}

const DASH: &str = r"[-‐‑‒–—]";

fn latin_bookless(separator: &str) -> String {
    format!(
        r"(?P<c1>\d{{1,3}})(?:{separator})(?P<v1>\d{{1,3}})(?:\s*{DASH}\s*(?P<n2>\d{{1,3}})(?:(?:{separator})(?P<v2>\d{{1,3}}))?)?"
    )
}

fn korean_bookless() -> String {
    format!(
        r"(?P<c1>\d{{1,3}})\s*:\s*(?P<v1>\d{{1,3}})(?:\s*{DASH}\s*(?P<n2>\d{{1,3}})(?:\s*:\s*(?P<v2>\d{{1,3}}))?)?|(?P<c1k>\d{{1,3}})\s*장\s*(?P<v1k>\d{{1,3}})(?:\s*[-~‐‑‒–—]\s*(?P<n2k>\d{{1,3}}))?\s*절"
    )
}

/// Verse-only shorthand, by language: its own words only (its pack's
/// `verse_words`), or the Korean verse unit after the number.
fn verse_only(language: ReferenceLanguage) -> String {
    let range = format!(r"(?P<vv1>\d{{1,3}})(?:\s*{DASH}\s*(?P<vv2>\d{{1,3}}))?");
    match packs::pack(language).shorthand.verse_words {
        Some(words) => format!(r"(?i)(?-u:\b)(?:{words})\s*{range}"),
        None => r"(?P<vv1>\d{1,3})(?:\s*[-~‐‑‒–—]\s*(?P<vv2>\d{1,3}))?\s*절".to_string(),
    }
}

/// Words that may stand right before a bookless reference even with a capital
/// (sentence-initial "See 15:4", "Vgl. 15,4"); any other capitalised word may be
/// a name the dictionary does not know, so the number after it is left alone.
const LEAD_WORDS: &[&str] = &[
    "see", "cf", "cp", "compare", "also", "and", "in", "vgl", "siehe", "s", "auch", "und", "voir",
    "et", "aussi", "véase", "vease", "ver", "y", "también", "e", "também", "comparar", "comp",
    "so", "but", "aber", "mais", "pero", "mas",
];

fn time_or_unit_after() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?i)^\s*(?:a\.?\s?m\b\.?|p\.?\s?m\b\.?|uhr\b|h\b|hrs?\b|hours?\b|o['’]clock|min\b|minut|heures?\b|horas?\b|hs\b|%|‰|°|€|\$|£|km\b|kg\b|mm\b|cm\b|m\b|g\b|l\b|ml\b|mio\b|millionen|mill|prozent|percent|euro|dollar|ratio|majority|odds|verhältnis|gewonnen|verloren|sieg\b|분|시\b|시간)",
        )
        .unwrap()
    })
}

fn time_word_before() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?i)(?:\b(?:at|um|ab|bis|from|until|till|à|a\s+las|a\s+la|às|ca|circa|etwa|approx)\.?|[€$£]|오전|오후|아침|저녁)\s*$",
        )
        .unwrap()
    })
}

/// Words before a pair of numbers that make it a ratio or a score, whatever its digits.
fn ratio_word_before() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\b(?:ratio\s+of|score\s+of|won|lost|beat|mit|gewann|verlor)\s*$").unwrap()
    })
}

/// A letter of the Latin script (basic, Latin-1, extended), as the Latin dictionaries are written.
fn is_latin_letter(c: char) -> bool {
    c.is_ascii_alphabetic()
        || ('\u{00C0}'..='\u{024F}').contains(&c)
        || ('\u{1E00}'..='\u{1EFF}').contains(&c)
}

impl ReferenceParser {
    fn bookless_patterns(&self) -> &'static (Regex, Regex) {
        static PATTERNS: OnceLock<Vec<OnceLock<(Regex, Regex)>>> = OnceLock::new();
        let all = PATTERNS.get_or_init(|| packs::PACKS.iter().map(|_| OnceLock::new()).collect());
        let language = self.language;
        let grammar = self.syntax.grammar;
        all[packs::index_of(language)].get_or_init(|| {
            let chapter_verse = match grammar {
                Grammar::Korean => korean_bookless(),
                Grammar::Latin => {
                    latin_bookless(packs::pack(language).shorthand.bookless_separator)
                }
            };
            (
                Regex::new(&chapter_verse).expect("bookless pattern is valid"),
                Regex::new(&verse_only(language)).expect("verse pattern is valid"),
            )
        })
    }

    /// Whether `,` joins references in a list in this language (its pack says).
    fn comma_joins_references(&self) -> bool {
        packs::pack(self.language).shorthand.comma_joins_list
    }

    /// The bookless references written in `text`, by shape alone (no context),
    /// with the false-positive guards applied. Byte offsets.
    pub fn bookless_candidates(&self, text: &str) -> Vec<Candidate> {
        let (chapter_verse, verse_only) = self.bookless_patterns();
        let number = |caps: &regex::Captures, names: &[&str]| -> Option<(u16, bool)> {
            names.iter().find_map(|n| caps.name(n)).map(|m| {
                let s = m.as_str();
                (s.parse().unwrap_or(0), s.len() > 1 && s.starts_with('0'))
            })
        };
        let mut out: Vec<Candidate> = Vec::new();
        for caps in chapter_verse.captures_iter(text) {
            let whole = caps.get(0).expect("a match");
            let parts = [
                number(&caps, &["c1", "c1k"]),
                number(&caps, &["v1", "v1k"]),
                number(&caps, &["n2", "n2k"]),
                number(&caps, &["v2"]),
            ];
            // Verses and chapters are never written with a leading zero ("1:05" is a time).
            if parts.iter().flatten().any(|(_, zero)| *zero) {
                continue;
            }
            let (Some((c1, _)), Some((v1, _))) = (parts[0], parts[1]) else {
                continue;
            };
            if !self.stands_alone(text, whole.start(), whole.end()) {
                continue;
            }
            out.push(Candidate {
                start: whole.start(),
                end: whole.end(),
                kind: CandidateKind::ChapterVerse {
                    c1,
                    v1,
                    n2: parts[2].map(|p| p.0),
                    v2: parts[3].map(|p| p.0),
                },
            });
        }
        for caps in verse_only.captures_iter(text) {
            let whole = caps.get(0).expect("a match");
            if out
                .iter()
                .any(|c| c.start < whole.end() && whole.start() < c.end)
            {
                continue;
            }
            let v1 = caps.name("vv1").map(|m| m.as_str());
            let v2 = caps.name("vv2").map(|m| m.as_str());
            if [v1, v2]
                .iter()
                .flatten()
                .any(|s| s.len() > 1 && s.starts_with('0'))
            {
                continue;
            }
            let Some(v1) = v1.and_then(|s| s.parse().ok()) else {
                continue;
            };
            // Not inside a longer number or word ("v.4.2", "Hauptvers 4"), not a Korean "장 … 절".
            let before = text[..whole.start()].chars().next_back();
            let after = &text[whole.end()..];
            let korean = self.syntax.grammar == Grammar::Korean;
            if before.is_some_and(|c| c.is_alphanumeric() || c == '_')
                || after.chars().next().is_some_and(|c| {
                    if korean {
                        c.is_ascii_alphanumeric()
                    } else {
                        c.is_alphanumeric()
                    }
                })
                || continues_number(after)
            {
                continue;
            }
            if self.syntax.grammar == Grammar::Korean
                && text[..whole.start()].trim_end().ends_with('장')
            {
                continue;
            }
            out.push(Candidate {
                start: whole.start(),
                end: whole.end(),
                kind: CandidateKind::VerseOnly {
                    v1,
                    v2: v2.and_then(|s| s.parse().ok()),
                },
            });
        }
        out.sort_by_key(|c| c.start);
        out
    }

    /// The false-positive guards around a chapter/verse candidate.
    fn stands_alone(&self, text: &str, start: usize, end: usize) -> bool {
        let before_text = &text[..start];
        let after_text = &text[end..];
        let before = before_text.chars().next_back();
        let after = after_text.chars().next();
        // Not part of a word or of a longer number ("2,5,7", "3:16:2", "x15:4"). Korean
        // attaches particles straight to a reference ("15장 4절과", "3:18을").
        let korean = self.syntax.grammar == Grammar::Korean;
        if before.is_some_and(|c| c.is_alphanumeric() || c == '_')
            || after.is_some_and(|c| {
                if korean {
                    c.is_ascii_alphanumeric()
                } else {
                    c.is_alphanumeric() || c == '_'
                }
            })
        {
            return false;
        }
        if continues_number(after_text) {
            return false;
        }
        // "3.14:15" or "1,2:3": the candidate continues a number written just before it.
        let mut back = before_text.chars().rev();
        if matches!(back.next(), Some('.' | ',' | ':'))
            && back.next().is_some_and(|c| c.is_ascii_digit())
        {
            return false;
        }
        let trimmed = before_text.trim_end_matches([' ', '\u{a0}']);
        if time_or_unit_after().is_match(after_text) {
            return false;
        }
        // "at 10:30", "um 9:45": after a time word, two-digit minutes make a time.
        // ("Look at 15:4" is a verse: minutes are always written with two digits.)
        let minutes = text[start..end]
            .rsplit(|c: char| !c.is_ascii_digit())
            .next()
            .is_some_and(|last| last.len() == 2);
        if (minutes && time_word_before().is_match(before_text))
            || ratio_word_before().is_match(before_text)
        {
            return false;
        }
        // The word just before: a book or name the dictionary does not know ("Rom 4,3",
        // where "Rom" is the city), or a book in another script ("요한복음 3:16" in a German
        // source, "John 3:16" in a Korean one), leaves the number after it alone.
        let word: String = trimmed
            .chars()
            .rev()
            .take_while(|c| c.is_alphabetic() || *c == '.')
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let bare = word.trim_end_matches('.');
        match self.syntax.grammar {
            Grammar::Latin => {
                if bare
                    .chars()
                    .any(|c| c.is_alphabetic() && !is_latin_letter(c))
                {
                    return false;
                }
                // Only mid-sentence: a sentence's first word is capitalised anyway.
                let opens_sentence = trimmed[..trimmed.len() - word.len()]
                    .trim_end()
                    .chars()
                    .next_back()
                    .is_none_or(|c| {
                        matches!(
                            c,
                            '.' | '!'
                                | '?'
                                | ':'
                                | ';'
                                | '('
                                | '['
                                | '"'
                                | '“'
                                | '„'
                                | '«'
                                | '\''
                                | '‘'
                                | '—'
                                | '–'
                        )
                    });
                if bare.chars().next().is_some_and(char::is_uppercase)
                    && !opens_sentence
                    && !LEAD_WORDS.contains(&bare.to_lowercase().as_str())
                {
                    return false;
                }
            }
            Grammar::Korean => {
                if bare.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                    return false;
                }
            }
        }
        true
    }

    /// The references of one paragraph, read in this language only: explicit
    /// ones, and bookless ones that the paragraph itself or `outer` resolves
    /// without doubt. (A source's paragraphs are read with every pack by
    /// `Recogniser::detect_in_context`.)
    pub fn detect_in_context(&self, text: &str, outer: &OuterContext) -> ParagraphReferences {
        self.detect_in_context_with(text, &self.matches(text), outer)
    }

    /// As [`Self::detect_in_context`], with the paragraph's explicit references
    /// already found (by every pack); the shorthand is read in this language.
    pub fn detect_in_context_with(
        &self,
        text: &str,
        explicit_matches: &[RawMatch],
        outer: &OuterContext,
    ) -> ParagraphReferences {
        let explicit: Vec<DetectedReference> =
            explicit_matches.iter().map(|m| m.detected(text)).collect();
        let explicit_bytes: Vec<(usize, usize, ScriptureRef)> = explicit_matches
            .iter()
            .map(|m| (m.start, m.end, m.reference))
            .collect();
        let candidates: Vec<Candidate> = self
            .bookless_candidates(text)
            .into_iter()
            .filter(|c| {
                !explicit_bytes
                    .iter()
                    .any(|(s, e, _)| c.start < *e && *s < c.end)
            })
            .collect();
        let mut contextual = Vec::new();
        if candidates.is_empty() {
            return ParagraphReferences {
                explicit,
                contextual,
            };
        }

        enum Event<'a> {
            Explicit(usize, ScriptureRef),
            Bookless(&'a Candidate),
        }
        let mut events: Vec<(usize, Event)> = explicit_bytes
            .iter()
            .map(|(s, e, r)| (*s, Event::Explicit(*e, *r)))
            .chain(candidates.iter().map(|c| (c.start, Event::Bookless(c))))
            .collect();
        events.sort_by_key(|(start, _)| *start);

        let mut paragraph = OuterContext::default();
        // The reference just before (its end and book), for lists.
        let mut previous: Option<(usize, &'static Book)> = None;
        for (_, event) in events {
            match event {
                Event::Explicit(end, reference) => {
                    paragraph.add(&reference);
                    previous = Some((end, reference.book));
                }
                Event::Bookless(candidate) => {
                    let resolved = match candidate.kind {
                        CandidateKind::ChapterVerse { c1, v1, n2, v2 } => {
                            let listed = previous
                                .filter(|(end, _)| self.joins_list(&text[*end..candidate.start]))
                                .map(|(_, book)| book);
                            let book = listed.or_else(|| {
                                let mut scope = paragraph.clone();
                                scope.merge(outer);
                                (scope.books.len() == 1).then(|| scope.books[0])
                            });
                            book.and_then(|book| {
                                let (start, end) = match (n2, v2) {
                                    (None, _) => ((c1, Some(v1)), (c1, Some(v1))),
                                    (Some(to), None) => ((c1, Some(v1)), (c1, Some(to))),
                                    (Some(c2), Some(v2)) => ((c1, Some(v1)), (c2, Some(v2))),
                                };
                                ScriptureRef::new(
                                    book,
                                    Point {
                                        chapter: start.0,
                                        verse: start.1,
                                    },
                                    Point {
                                        chapter: end.0,
                                        verse: end.1,
                                    },
                                )
                                .ok()
                            })
                        }
                        CandidateKind::VerseOnly { v1, v2 } => {
                            let mut scope = paragraph.clone();
                            scope.merge(outer);
                            (scope.chapters.len() == 1)
                                .then(|| scope.chapters[0])
                                .and_then(|(book, chapter)| {
                                    ScriptureRef::new(
                                        book,
                                        Point {
                                            chapter,
                                            verse: Some(v1),
                                        },
                                        Point {
                                            chapter,
                                            verse: Some(v2.unwrap_or(v1)),
                                        },
                                    )
                                    .ok()
                                })
                        }
                    };
                    if let Some(reference) = resolved {
                        previous = Some((candidate.end, reference.book));
                        contextual.push(DetectedReference {
                            text: text[candidate.start..candidate.end].to_string(),
                            start: utf16_offset(text, candidate.start),
                            end: utf16_offset(text, candidate.end),
                            reference: reference.to_dto(),
                        });
                    }
                }
            }
        }
        ParagraphReferences {
            explicit,
            contextual,
        }
    }

    /// Whether the text between two references joins them in a list.
    fn joins_list(&self, between: &str) -> bool {
        let t = between.trim();
        t == ";" || (t == "," && self.comma_joins_references())
    }
}

/// What a heading establishes: the references in it, in any language.
pub fn heading_context(recogniser: &Recogniser, heading: &str) -> OuterContext {
    let mut context = OuterContext::default();
    for found in recogniser.detect(heading) {
        if let Ok(reference) = ScriptureRef::from_canonical(&found.reference.canonical) {
            context.add(&reference);
        }
    }
    context
}

/// Kinds of source written around one passage: a sermon or a lecture on its
/// text. ("notes" is not among them: it is the default kind of every Markdown
/// and plain-text file, so it says nothing about the content.)
pub const MAIN_PASSAGE_KINDS: &[&str] = &["sermon", "lecture"];
/// The opening of a document that can name its main passage: its first
/// paragraphs while they read as a title or heading line (short, and not ending
/// as a sentence does).
pub const OPENING_PARAGRAPHS: usize = 2;
pub const OPENING_CHARS: usize = 80;

/// Whether a paragraph reads as a title or heading line rather than prose:
/// short ([`OPENING_CHARS`] at most), not ending as a sentence does, and not a
/// pointer to a passage ("Compare John 3:16", "Vgl. Röm 8,1", "(요 3:16 참조)"):
/// a line that begins with a reference lead-in of any language pack, or ends
/// with a trailing one, is not a heading. The reference may stand anywhere in a
/// heading ("The New Birth — John 3:1–8").
pub fn heading_line(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty()
        || text.chars().count() > OPENING_CHARS
        || text.ends_with(['.', '!', '?', '…'])
    {
        return false;
    }
    let lower = text
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    let trimmed_end = text
        .trim_end_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    !packs::PACKS.iter().any(|pack| {
        pack.reference_lead_ins.iter().any(|lead| {
            lower.strip_prefix(lead).is_some_and(|rest| {
                // a whole word: "See", "Vgl.", "Siehe:", not "Seeds" or "Seen"
                rest.chars().next().is_none_or(|c| !c.is_alphanumeric())
            })
        }) || pack
            .reference_tails
            .iter()
            .any(|tail| trimmed_end.ends_with(tail))
    })
}

/// The main passage of a whole document (v0.13.1), from unusually strong
/// evidence only:
///
/// * the source is a sermon or a lecture (as the person filed it), and
/// * its title, and its opening title lines (the first [`OPENING_PARAGRAPHS`]
///   paragraphs, while each is at most [`OPENING_CHARS`] characters and does not
///   end with `.`, `!`, `?` or `…`), name passages of **exactly one book**.
///
/// Verse-only shorthand also needs one chapter there. A competing passage of
/// another book in that title area, or none at all, gives no main passage. A
/// reference in the body never establishes one.
pub fn document_context(
    recogniser: &Recogniser,
    kind: Option<&str>,
    title: &str,
    opening: &[&str],
) -> OuterContext {
    if !kind.is_some_and(|k| MAIN_PASSAGE_KINDS.contains(&k)) {
        return OuterContext::default();
    }
    let mut area = vec![title];
    area.extend(
        opening
            .iter()
            .take(OPENING_PARAGRAPHS)
            .take_while(|text| heading_line(text))
            .copied(),
    );
    let mut context = OuterContext::default();
    let mut spans_chapters = false;
    for text in area {
        for found in recogniser.detect(text) {
            if let Ok(reference) = ScriptureRef::from_canonical(&found.reference.canonical) {
                spans_chapters |= reference.start.chapter != reference.end.chapter;
                context.add(&reference);
            }
        }
    }
    if context.books.len() != 1 {
        return OuterContext::default();
    }
    if spans_chapters || context.chapters.len() != 1 {
        context.chapters.clear();
    }
    context
}

/// Whether text right after a candidate continues a number ("3:16:2", "2,5,7", "3.14").
fn continues_number(after: &str) -> bool {
    let mut chars = after.chars();
    matches!(chars.next(), Some('.' | ',' | ':'))
        && chars.next().is_some_and(|c| c.is_ascii_digit())
}

/// Walks a source's paragraphs in reading order and carries context between
/// them, within strict bounds:
///
/// * a source divided by headings (EPUB, Word, Markdown): the deepest heading
///   of the section path that names passages is the section's context for all
///   its paragraphs; explicit references in a paragraph count for the next
///   [`SECTION_LOOKBACK`] paragraphs of the same section; a new section (any
///   change of section path) starts afresh;
/// * a source without sections (PDF, text): explicit references count for the
///   next [`PAGE_LOOKBACK`] paragraphs on the same page only;
/// * a sermon or lecture whose title area names one passage
///   ([`document_context`]): that passage counts throughout the document, on
///   every page, wherever no heading names another; it is gathered with the
///   other context, so a competing book nearby still makes a reference
///   ambiguous.
///
/// **Suspension.** When a section's own heading or a visible heading line
/// names a different book, the outer context it displaces (the main passage,
/// an enclosing heading, the heading line before) is **suspended**, and stays
/// suspended after that section ends. A suspended book resumes only when it is
/// named again explicitly: a reference to it anywhere, or a heading naming it.
/// A neutral heading ("Application") and the end of a section resume nothing.
pub struct ContextTracker<'p> {
    recogniser: &'p Recogniser,
    sectioned: bool,
    path: Option<String>,
    page: Option<i64>,
    heading: OuterContext,
    /// The document's main passage ([`document_context`]): stands in for a
    /// section heading wherever the section's own headings name no passage.
    document: OuterContext,
    /// The explicit references of the latest paragraph that had some, and how
    /// many paragraphs ago that was.
    recent: Option<(OuterContext, usize)>,
    /// A visible heading line naming one book (v0.13.2): a short paragraph that
    /// reads as a heading ("A different section: Romans 8:1–4"), whatever the
    /// format, and how many paragraphs ago it was. It governs the paragraphs
    /// after it like a section heading, until the next heading line, a new
    /// section, or [`LOCAL_HEADING_SPAN`] paragraphs.
    local: Option<(OuterContext, usize)>,
    /// Books whose outer context is suspended: a heading (a section's own
    /// heading or a visible heading line) named a different book, displacing
    /// the main passage or an enclosing heading. They stay suspended after that
    /// section ends, and each resumes only when it is named again explicitly: a
    /// reference to it, or a heading naming it.
    suspended: Vec<&'static str>,
}

/// How many paragraphs a visible heading line governs at most.
pub const LOCAL_HEADING_SPAN: usize = 8;

impl<'p> ContextTracker<'p> {
    pub fn new(recogniser: &'p Recogniser, sectioned: bool) -> Self {
        Self {
            recogniser,
            sectioned,
            path: None,
            page: None,
            heading: OuterContext::default(),
            document: OuterContext::default(),
            recent: None,
            local: None,
            suspended: Vec::new(),
        }
    }

    /// Whether every book of a context is suspended (an empty context is not).
    fn all_suspended(&self, context: &OuterContext) -> bool {
        !context.books.is_empty()
            && context
                .books
                .iter()
                .all(|b| self.suspended.contains(&b.code))
    }

    /// A heading naming `named` was met, displacing the outer context `displaced`:
    /// the displaced books it does not name are suspended; the books it names resume.
    fn heading_met(&mut self, named: &OuterContext, displaced: &[&'static Book]) {
        if named.books.is_empty() {
            return;
        }
        for book in displaced {
            if !named.books.iter().any(|b| b.code == book.code)
                && !self.suspended.contains(&book.code)
            {
                self.suspended.push(book.code);
            }
        }
        self.resume(named);
    }

    /// The books named explicitly resume.
    fn resume(&mut self, named: &OuterContext) {
        self.suspended
            .retain(|code| !named.books.iter().any(|b| b.code == *code));
    }

    /// The document's main passage, for every paragraph whose section heading names none.
    pub fn with_document(mut self, document: OuterContext) -> Self {
        self.document = document;
        self
    }

    /// The references of the next paragraph.
    pub fn next(
        &mut self,
        text: &str,
        section_path: Option<&str>,
        page: Option<i64>,
    ) -> ParagraphReferences {
        if self.sectioned {
            if section_path != self.path.as_deref() {
                self.path = section_path.map(str::to_string);
                self.recent = None;
                self.local = None;
                let recogniser = self.recogniser;
                // The headings of the path that name passages, deepest first, and
                // whether the deepest is this section's own heading or an enclosing one.
                let named: Vec<(usize, OuterContext)> = section_path
                    .map(|path| {
                        path.rsplit(crate::library::sections::PATH_SEPARATOR)
                            .map(|part| heading_context(recogniser, part))
                            .enumerate()
                            .filter(|(_, c)| !c.books.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();
                let (heading, own) = named
                    .first()
                    .map(|(depth, c)| (c.clone(), *depth == 0))
                    .unwrap_or_default();
                if own {
                    // A section's own heading displaces the main passage and the
                    // enclosing headings.
                    let mut displaced: Vec<&'static Book> = self.document.books.clone();
                    for (_, enclosing) in named.iter().skip(1) {
                        displaced.extend(enclosing.books.iter().copied());
                    }
                    self.heading_met(&heading, &displaced);
                }
                // An enclosing heading whose books are suspended ("John 15:1–11" above
                // "Application", after a Romans section) does not govern: only a
                // section's own heading, or an explicit reference, brings it back.
                self.heading = if !own && self.all_suspended(&heading) {
                    OuterContext::default()
                } else {
                    heading
                };
            }
        } else if page != self.page {
            self.page = page;
            self.recent = None;
        }
        let limit = if self.sectioned {
            SECTION_LOOKBACK
        } else {
            PAGE_LOOKBACK
        };
        // The nearest heading governs: a visible heading line, then the section's
        // heading, then the document's main passage.
        let local = self
            .local
            .as_ref()
            .filter(|(_, age)| *age < LOCAL_HEADING_SPAN)
            .map(|(context, _)| context);
        let mut outer = match local {
            Some(local) => local.clone(),
            None if !self.heading.books.is_empty() => self.heading.clone(),
            None if !self.all_suspended(&self.document) => self.document.clone(),
            None => OuterContext::default(),
        };
        if let Some((recent, age)) = &self.recent {
            if *age < limit {
                outer.merge(recent);
            }
        }
        let found = if text.chars().any(|c| c.is_ascii_digit()) {
            self.recogniser.detect_in_context(text, &outer)
        } else {
            ParagraphReferences::default()
        };
        // Age what there was; the explicit references of this paragraph become the recent ones.
        if let Some((_, age)) = &mut self.recent {
            *age += 1;
        }
        if let Some((_, age)) = &mut self.local {
            *age += 1;
        }
        let mut named = OuterContext::default();
        for r in &found.explicit {
            if let Ok(reference) = ScriptureRef::from_canonical(&r.reference.canonical) {
                named.add(&reference);
            }
        }
        // A book named explicitly resumes.
        self.resume(&named);
        // A heading line starts a new local section, as a new section does: it ends
        // the heading line before it and what the paragraphs before it named; one that
        // names a single book governs what follows.
        if heading_line(text) {
            self.recent = None;
            if named.books.len() == 1 {
                // It displaces the main passage, the section's heading and the line before it.
                let mut displaced: Vec<&'static Book> = self.document.books.clone();
                displaced.extend(self.heading.books.iter().copied());
                if let Some((previous, _)) = &self.local {
                    displaced.extend(previous.books.iter().copied());
                }
                self.heading_met(&named, &displaced);
                self.local = Some((named.clone(), 0));
            } else {
                self.local = None;
            }
        }
        if !found.explicit.is_empty() {
            self.recent = Some((named, 0));
        }
        found
    }
}
