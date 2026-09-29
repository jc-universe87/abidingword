//! A USFM reader: turns one USFM book file into plain verse text.
//!
//! USFM (Unified Standard Format Markers, https://ubsicap.github.io/usfm/)
//! is a line-oriented text format with backslash markers: `\id JHN`,
//! `\c 15`, `\v 7 …`. The reader keeps the words of the text and drops
//! everything that is not verse text: footnotes and cross-references,
//! word-level attributes such as Strong's numbers, headings, introductions
//! and titles. Psalm titles (`\d`) are kept separately as superscriptions.
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
}

/// A verse exactly as read: numbers as written, text cleaned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawVerse {
    pub chapter: String,
    pub label: String,
    pub text: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    Nothing,
    Verse,
    Superscription,
}

fn regexes() -> &'static (Regex, Regex, Regex) {
    static RE: OnceLock<(Regex, Regex, Regex)> = OnceLock::new();
    RE.get_or_init(|| {
        (
            // Footnotes, endnotes and cross-references, with their content.
            Regex::new(r"(?s)\\(f|fe|ef|x|ex)\s.*?\\(f|fe|ef|x|ex)\*").unwrap(),
            // Word attributes: `\w word|strong="G1"\w*` keeps only `word`.
            Regex::new(r"\|[^\\|]*(\\\+?[a-z]+[0-9]*\*)").unwrap(),
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

pub fn parse(source: &str) -> UsfmDocument {
    let (notes, attributes, marker) = regexes();
    let without_notes = notes.replace_all(source, " ");
    let cleaned = attributes.replace_all(&without_notes, "$1");

    let mut doc = UsfmDocument::default();
    let mut chapter: Option<String> = None;
    let mut current: Option<RawVerse> = None;
    let mut superscription = String::new();
    let mut target = Target::Nothing;
    let mut skip_depth: Vec<String> = Vec::new();
    // What the next text segment is: normal content, or a number/code.
    let mut expect: Option<&'static str> = None;

    let finish_verse = |doc: &mut UsfmDocument, current: &mut Option<RawVerse>| {
        if let Some(mut verse) = current.take() {
            verse.text = collapse(&verse.text);
            doc.verses.push(verse);
        }
    };
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
                let mut text = text;
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
                                    current = Some(RawVerse {
                                        chapter: c.clone(),
                                        label: first.to_string(),
                                        text: String::new(),
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
                        if let Some(verse) = current.as_mut() {
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
                if closing || is_known_character(&name) {
                    continue;
                }
                match name.as_str() {
                    "id" => {
                        finish_verse(&mut doc, &mut current);
                        expect = Some("id");
                        target = Target::Nothing;
                    }
                    "c" => {
                        finish_verse(&mut doc, &mut current);
                        finish_superscription(&mut doc, &chapter, &mut superscription);
                        expect = Some("c");
                        target = Target::Nothing;
                    }
                    "v" => {
                        finish_verse(&mut doc, &mut current);
                        finish_superscription(&mut doc, &chapter, &mut superscription);
                        expect = Some("v");
                    }
                    "d" => {
                        finish_verse(&mut doc, &mut current);
                        target = Target::Superscription;
                    }
                    other if is_paragraph(other) => {
                        if target == Target::Superscription {
                            finish_superscription(&mut doc, &chapter, &mut superscription);
                        }
                        target = if current.is_some() {
                            if let Some(verse) = current.as_mut() {
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
    finish_verse(&mut doc, &mut current);
    finish_superscription(&mut doc, &chapter, &mut superscription);
    doc
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
