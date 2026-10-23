//! MorphGNT (v0.22): the SBL Greek New Testament with a lemma and a
//! morphology code on every word, in MorphGNT's own plain-text format
//! (github.com/morphgnt/sblgnt, one `NN-Bk-morphgnt.txt` per book).
//!
//! Each line is one word, seven columns separated by single spaces
//! (MorphGNT README): book/chapter/verse (`040101`: book 04 of the New
//! Testament, John 1:1), part of speech, parsing code, text with
//! punctuation, word, normalised word, lemma.
//!
//! - **Text**: the verse's text column, words joined by single spaces.
//! - **Words**: the word column, placed inside its text token; the lemma
//!   (a real dictionary form, e.g. λόγος) as the word's lemma; the code as
//!   written, part of speech and parsing (`N- ----NSM-`). MorphGNT gives no
//!   lexical numbers, so none are stored.
//!
//! A line that does not have the seven columns, or a book number outside
//! the New Testament, is not read; too many such lines and the file is not
//! taken for MorphGNT.

use super::grammar::Statement;
use super::import::{
    BibleImportAdapter, Severity, SourceText, StagedBook, StagedContent, StagedWord,
};
use super::morphology::MORPHGNT;
use super::usfm::WordShape;
use crate::error::UserMessage;
use crate::scripture::canon;

pub struct MorphGntAdapter;

/// One line, read.
struct Line<'a> {
    book: u8,
    chapter: u16,
    verse: u16,
    pos: &'a str,
    parsing: &'a str,
    text: &'a str,
    word: &'a str,
    lemma: &'a str,
}

fn line(raw: &str) -> Option<Line<'_>> {
    let mut cols = raw.split(' ');
    let bcv = cols.next()?;
    let (pos, parsing, text, word, _normal, lemma) = (
        cols.next()?,
        cols.next()?,
        cols.next()?,
        cols.next()?,
        cols.next()?,
        cols.next()?,
    );
    if cols.next().is_some() || bcv.len() != 6 || !bcv.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let book: u8 = bcv[0..2].parse().ok()?;
    let chapter: u16 = bcv[2..4].parse().ok()?;
    let verse: u16 = bcv[4..6].parse().ok()?;
    if !(1..=27).contains(&book) || chapter == 0 || verse == 0 {
        return None;
    }
    if pos.chars().count() != 2
        || parsing.chars().count() != 8
        || text.is_empty()
        || lemma.is_empty()
    {
        return None;
    }
    Some(Line {
        book,
        chapter,
        verse,
        pos,
        parsing,
        text,
        word,
        lemma,
    })
}

/// Whether a file is MorphGNT: its first lines are MorphGNT lines.
pub fn is_morphgnt(text: &str) -> bool {
    let lines: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(5)
        .collect();
    !lines.is_empty() && lines.iter().all(|l| line(l).is_some())
}

impl BibleImportAdapter for MorphGntAdapter {
    fn format(&self) -> &'static str {
        "morphgnt"
    }

    fn can_read(&self, file: &SourceText) -> bool {
        is_morphgnt(&file.text)
    }

    fn read(&self, files: &[SourceText], staged: &mut StagedContent) {
        staged.declared_grammar = Some((
            MORPHGNT,
            Statement {
                file: files.first().map(|f| f.name.clone()).unwrap_or_default(),
                words: "MorphGNT".into(),
            },
        ));
        for file in files {
            read_file(file, staged);
        }
    }
}

fn read_file(file: &SourceText, staged: &mut StagedContent) {
    let mut bad = 0usize;
    let mut total = 0usize;
    let mut book: Option<&'static canon::Book> = None;
    let mut content = StagedBook::default();
    // The verse being read: (chapter, verse), its text and its words.
    let mut current: Option<((u16, u16), String, usize, Vec<StagedWord>)> = None;
    let flush = |staged: &mut StagedContent,
                 content: &mut StagedBook,
                 book: &'static canon::Book,
                 verse: ((u16, u16), String, usize, Vec<StagedWord>)| {
        let ((c, v), text, _, words) = verse;
        let words = staged.words.add_structured(words, "morphgnt");
        staged.add_verse(book, content, &c.to_string(), &v.to_string(), text, words);
    };
    for raw in file.text.lines() {
        if raw.trim().is_empty() {
            continue;
        }
        total += 1;
        let Some(l) = line(raw.trim_end_matches('\r')) else {
            bad += 1;
            continue;
        };
        let this = canon::by_ordinal(39 + l.book);
        match (book, this) {
            (None, Some(b)) => book = Some(b),
            (Some(known), Some(b)) if known.ordinal == b.ordinal => {}
            _ => {
                bad += 1;
                continue;
            }
        }
        let Some(b) = book else { continue };
        if current
            .as_ref()
            .is_some_and(|(at, ..)| *at != (l.chapter, l.verse))
        {
            if let Some(verse) = current.take() {
                flush(staged, &mut content, b, verse);
            }
        }
        let (_, text, units, words) =
            current.get_or_insert_with(|| ((l.chapter, l.verse), String::new(), 0, Vec::new()));
        if !text.is_empty() {
            text.push(' ');
            *units += 1;
        }
        let token_start = *units;
        text.push_str(l.text);
        *units += l.text.encode_utf16().count();
        // The word inside its token (the token adds punctuation around it).
        if let Some(at) = (!l.word.is_empty()).then(|| l.text.find(l.word)).flatten() {
            let start = token_start + l.text[..at].encode_utf16().count();
            let end = start + l.word.encode_utf16().count();
            words.push(StagedWord {
                start,
                end,
                surface: l.word.to_string(),
                shape: WordShape::Word,
                lemma: Some(l.lemma.to_string()),
                strong: None,
                morph: Some(format!("{} {}", l.pos, l.parsing)),
                ids: Vec::new(),
            });
        } else {
            staged.words.report.left_out.empty += 1;
            staged.words.report.marked += 1;
        }
    }
    if let (Some(verse), Some(b)) = (current.take(), book) {
        flush(staged, &mut content, b, verse);
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
    if bad > 0 {
        let severity = if bad > 10 && bad * 100 > total {
            Severity::Error
        } else {
            Severity::Warning
        };
        staged.issue(
            severity,
            Some(book),
            None,
            UserMessage::new(
                "bibleImport.badLines",
                format!(
                    "{}: {bad} lines of “{}” could not be read.",
                    book.name, file.name
                ),
            )
            .with("bookCode", book.code)
            .with("fileName", &file.name)
            .with("count", bad),
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
