//! The Open Scriptures Hebrew Bible's OSIS files (v0.22): the Westminster
//! Leningrad Codex with a lemma and a morphology code on every word, one
//! book per file (`wlc/Gen.xml` … in github.com/openscriptures/morphhb).
//!
//! Only this OSIS (its header names the work `OSHB`) is read; other OSIS
//! files are not, since OSIS publishers use the format in different ways.
//!
//! - **Text**: each `<verse>`'s words as written, with OSHB's morpheme
//!   separators (`/`) removed, and its `<seg>` marks (maqaf ־, sof pasuq ׃,
//!   paseq ׀, the petuchah/setumah letters) where they stand. Notes
//!   (`<note>`, with the qere readings inside them) are not text; a ketiv
//!   word is the text, as the codex writes it.
//! - **Words**: `lemma` is OSHB's lexical identifier — a Strong's-based
//!   number with prefix letters and a homograph letter (`c/d/776`,
//!   `1254 a`), *not* a dictionary form — and is stored as the word's lexical
//!   number, each `/` part an identifier; `morph` is the OSHB code. No
//!   dictionary form is invented.
//! - **Verse numbers** are Hebrew; see `versification`.

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

use super::grammar::Statement;
use super::import::VersePart;
use super::import::{
    BibleImportAdapter, Severity, SourceText, StagedBook, StagedContent, StagedWord,
};
use super::morphology::OSHB;
use super::usfm::WordShape;
use super::versification::{osis_book, osis_verse, split_part};
use crate::error::UserMessage;

pub struct OshbAdapter;

/// The first bytes of a text where its header is, cut on a character boundary.
fn head(text: &str) -> &str {
    let mut end = text.len().min(20_000);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Whether a file is OSHB's OSIS.
pub fn is_oshb(text: &str) -> bool {
    let head = head(text);
    head.contains("<osis")
        && (head.contains("osisIDWork=\"OSHB\"") || head.contains("osisWork=\"OSHB\""))
}

fn attr(e: &BytesStart, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| {
            a.normalized_value(XmlVersion::Implicit1_0)
                .ok()
                .map(|v| v.into_owned())
        })
}

/// The text inside an element whose name is `tag` (first one), for header fields.
fn header_field(text: &str, open: &str, close: &str) -> Option<String> {
    let start = text.find(open)? + open.len();
    let end = start + text[start..].find(close)?;
    let value = text[start..end].trim();
    (!value.is_empty() && value.len() < 300 && !value.contains('<')).then(|| value.to_string())
}

/// What the header says: the work's title and the rights of OSHB and WLC.
pub fn header(text: &str) -> (Option<String>, Option<String>) {
    let head = head(text);
    let block = |work: &str| {
        let at = head.find(&format!("osisWork=\"{work}\""))?;
        let rest = &head[at..];
        Some(rest[..rest.find("</work>").unwrap_or(rest.len())].to_string())
    };
    let title = block("OSHB").and_then(|b| header_field(&b, "<title>", "</title>"));
    let rights = |work: &str| {
        block(work).and_then(|b| {
            let at = b.find("<rights")?;
            let open_end = at + b[at..].find('>')? + 1;
            header_field(&b[open_end - 1..], ">", "</rights>")
        })
    };
    let licence = match (rights("WLC"), rights("OSHB")) {
        (Some(text), Some(words)) => Some(format!(
            "Text (WLC): {text}; lemmas and morphology (OSHB): {words}"
        )),
        (None, Some(words)) => Some(format!("Lemmas and morphology (OSHB): {words}")),
        _ => None,
    };
    (title, licence)
}

struct Builder {
    text: String,
    units: usize,
    pending_space: bool,
    words: Vec<StagedWord>,
}

impl Builder {
    fn new() -> Self {
        Builder {
            text: String::new(),
            units: 0,
            pending_space: false,
            words: Vec::new(),
        }
    }

    fn push(&mut self, piece: &str) {
        if self.pending_space && !self.text.is_empty() {
            self.text.push(' ');
            self.units += 1;
        }
        self.pending_space = false;
        self.text.push_str(piece);
        self.units += piece.encode_utf16().count();
    }
}

impl BibleImportAdapter for OshbAdapter {
    fn format(&self) -> &'static str {
        "osis"
    }

    fn can_read(&self, file: &SourceText) -> bool {
        is_oshb(&file.text)
    }

    fn read(&self, files: &[SourceText], staged: &mut StagedContent) {
        for file in files {
            if staged.declared_grammar.is_none() {
                staged.declared_grammar = Some((
                    OSHB,
                    Statement {
                        file: file.name.clone(),
                        words: "osisWork=\"OSHB\"".into(),
                    },
                ));
                let (title, licence) = header(&file.text);
                staged.hints.name = staged.hints.name.take().or(title);
                staged.hints.license = staged.hints.license.take().or(licence);
            }
            read_file(file, staged);
        }
    }
}

fn read_file(file: &SourceText, staged: &mut StagedContent) {
    let mut reader = Reader::from_str(&file.text);
    reader.config_mut().check_end_names = true;
    let mut book: Option<&'static crate::scripture::canon::Book> = None;
    let mut content = StagedBook::default();
    // (chapter, verse) of the verse being read, and its text.
    let mut current: Option<(String, String, Builder)> = None;
    let mut note_depth = 0usize;
    // Inside a <w>: its attributes and text so far.
    let mut word: Option<(Option<String>, Option<String>, String)> = None;
    let mut in_seg = false;
    let mut broken = false;
    // OSHB's own alignment: a `<note>KJV:Isa.64.1</note>` where an English
    // verse begins. Read only to divide a Hebrew verse that holds parts of
    // two English verses, and only when a verse map is used.
    let split = staged.verse_map.is_some();
    let mut note_text = String::new();
    // The verse's segments so far: (part letter, the marker's target).
    let mut part: Option<char> = None;
    let mut segment_target: Option<(u16, u16)> = None;
    let finish = |staged: &mut StagedContent,
                  content: &mut StagedBook,
                  book: &'static crate::scripture::canon::Book,
                  verse: (String, String, Builder),
                  part: Option<char>,
                  marker: Option<(u16, u16)>| {
        let (chapter, label, built) = verse;
        let words = staged.words.add_structured(built.words, "morph");
        staged.add_verse_part(
            book,
            content,
            &chapter,
            &label,
            VersePart { part, marker },
            built.text,
            words,
        );
    };
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                "note" => {
                    note_depth += 1;
                    if note_depth == 1 {
                        note_text.clear();
                    }
                }
                _ if note_depth > 0 => {}
                "verse" => {
                    let Some(id) = attr(&e, "osisID") else {
                        broken = true;
                        continue;
                    };
                    let mut parts = id.split('.');
                    let (Some(b), Some(c), Some(v), None) =
                        (parts.next(), parts.next(), parts.next(), parts.next())
                    else {
                        broken = true;
                        continue;
                    };
                    let Some(found) = osis_book(b) else {
                        broken = true;
                        continue;
                    };
                    match book {
                        None => book = Some(found),
                        Some(known) if known.ordinal != found.ordinal => {
                            broken = true;
                            continue;
                        }
                        Some(_) => {}
                    }
                    current = Some((c.to_string(), v.to_string(), Builder::new()));
                    part = None;
                    segment_target = None;
                }
                "w" if current.is_some() => {
                    word = Some((attr(&e, "lemma"), attr(&e, "morph"), String::new()))
                }
                "seg" if current.is_some() => in_seg = true,
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "note" => {
                    note_depth = note_depth.saturating_sub(1);
                    let marker = note_text.trim().strip_prefix("KJV:").map(str::to_string);
                    if note_depth > 0 || !split {
                        continue;
                    }
                    let (Some(marker), Some(found)) = (marker, book) else {
                        continue;
                    };
                    // "Isa.64.1" or "1Kgs.22.43!b": the English verse beginning here.
                    let target = split_part(&marker)
                        .and_then(|(base, _)| osis_verse(base))
                        .filter(|(ordinal, _, _)| *ordinal == found.ordinal);
                    let Some((_, c, v)) = target else {
                        broken = true;
                        continue;
                    };
                    match current.as_mut() {
                        // At the start of the verse: where the whole verse (or its first part) goes.
                        Some((_, _, built)) if built.text.is_empty() => {
                            segment_target = Some((c, v))
                        }
                        Some(_) => {
                            // Inside the verse: what came before is one part, what follows another.
                            let Some((chapter, label, built)) = current.take() else {
                                continue;
                            };
                            let this = part.unwrap_or('a');
                            // More parts than any verse has: not this edition's marks.
                            if this >= 'z' {
                                broken = true;
                                continue;
                            }
                            staged.split_marks += 1;
                            finish(
                                staged,
                                &mut content,
                                found,
                                (chapter.clone(), label.clone(), built),
                                Some(this),
                                segment_target,
                            );
                            current = Some((chapter, label, Builder::new()));
                            part = Some(((this as u8) + 1) as char);
                            segment_target = Some((c, v));
                        }
                        None => {}
                    }
                }
                _ if note_depth > 0 => {}
                "w" => {
                    if let (Some((lemma, morph, raw)), Some((_, _, built))) =
                        (word.take(), current.as_mut())
                    {
                        let surface: String = raw.chars().filter(|c| *c != '/').collect();
                        let surface = surface.trim().to_string();
                        if surface.is_empty() {
                            continue;
                        }
                        let leading_space = built.pending_space && !built.text.is_empty();
                        let start = built.units + usize::from(leading_space);
                        built.push(&surface);
                        let end = built.units;
                        let strong = lemma
                            .map(|l| l.trim().to_string())
                            .filter(|l| !l.is_empty());
                        let ids: Vec<String> = strong
                            .iter()
                            .flat_map(|s| s.split('/'))
                            .map(|p| p.trim().to_string())
                            // Prefix letters (c, b, d…) are morphemes, not lexical numbers.
                            .filter(|p| p.starts_with(|c: char| c.is_ascii_digit()))
                            .fold(Vec::new(), |mut acc, p| {
                                if !acc.contains(&p) {
                                    acc.push(p);
                                }
                                acc
                            });
                        built.words.push(StagedWord {
                            start,
                            end,
                            surface,
                            shape: WordShape::Word,
                            lemma: None,
                            strong,
                            morph: morph
                                .map(|m| m.trim().to_string())
                                .filter(|m| !m.is_empty()),
                            ids,
                        });
                    }
                }
                "seg" => in_seg = false,
                "verse" => {
                    if let (Some(verse), Some(book)) = (current.take(), book) {
                        finish(staged, &mut content, book, verse, part, segment_target);
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) if note_depth == 1 => note_text.push_str(&t),
            Ok(Event::Text(t)) if note_depth == 0 => {
                let piece: &str = &t;
                if let Some((_, _, raw)) = word.as_mut() {
                    raw.push_str(piece);
                } else if let Some((_, _, built)) = current.as_mut() {
                    if in_seg {
                        let mark = piece.trim();
                        if !mark.is_empty() {
                            // Marks attach to the word before them (maqaf, sof pasuq)…
                            let spaced = built.pending_space;
                            built.pending_space = spaced && !matches!(mark, "־" | "׃");
                            built.push(mark);
                        }
                    } else if piece.trim().is_empty() {
                        built.pending_space = true;
                    } else {
                        built.push(piece.trim());
                    }
                }
            }
            Ok(Event::GeneralRef(r)) if note_depth == 0 => {
                // The predefined entities only; anything else is not Scripture text.
                let named = match &*r {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    _ => None,
                };
                // A character reference is decoded; anything else is not read silently.
                let Some(c) = named.or_else(|| r.resolve_char_ref().ok().flatten()) else {
                    broken = true;
                    continue;
                };
                let mut buffer = [0u8; 4];
                let piece: &str = c.encode_utf8(&mut buffer);
                if let Some((_, _, raw)) = word.as_mut() {
                    raw.push_str(piece);
                } else if let Some((_, _, built)) = current.as_mut() {
                    built.push(piece);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => {
                broken = true;
                break;
            }
            _ => {}
        }
    }
    let Some(book) = book else {
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
        return;
    };
    if broken {
        staged.issue(
            Severity::Error,
            Some(book),
            None,
            UserMessage::new(
                "bibleImport.badOsis",
                format!("The file “{}” could not be read completely.", file.name),
            )
            .with("fileName", &file.name),
        );
    }
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
        return;
    }
    staged.books.insert(book.ordinal, content);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_header_is_cut_on_a_character_boundary() {
        // Hebrew letters are two bytes: put one across the 20,000th byte.
        let text = format!(
            "<osis><osisText osisIDWork=\"OSHB\">{}פפפ",
            "a".repeat(19_999 - 34)
        );
        assert!(text.len() > 20_000 && !text.is_char_boundary(20_000));
        assert!(is_oshb(&text));
        assert_eq!(header(&text), (None, None));
    }
}
