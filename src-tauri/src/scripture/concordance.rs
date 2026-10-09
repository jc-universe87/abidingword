//! Concordance (v0.12): where a word or phrase occurs in one Bible translation.
//!
//! Deterministic and surface-form only: it answers "where does this form
//! occur?", never "which lemma is this?" (no lemma or morphology data exists
//! yet; see docs/concordance-v0.12.md). Everything here is a rule that can be
//! read and tested:
//!
//! - **Tokens** are maximal runs of letters, digits and combining marks;
//!   everything else (spaces, punctuation, the Hebrew maqaf, apostrophes)
//!   separates them. So "grace" never matches inside "disgrace".
//! - **Normalisation** (per token, by script, never by guessing a language):
//!   canonical composition (NFC) and lower case everywhere. Latin, Cyrillic and
//!   Hangul keep their accents and marks: "é" ≠ "e", "über" ≠ "uber". Greek
//!   drops accents, breathings and diaeresis and writes final sigma as σ, as
//!   accents move with context. Hebrew drops points and cantillation, so a
//!   pointed and an unpointed spelling match.
//! - A **word** is one token; a **phrase** is consecutive tokens.
//!
//! The full-text index (`bible_verse_search`, unicode61 with diacritics
//! removed) only narrows the verses to read when its matching is known to be
//! looser than these rules (Latin and Hangul); Greek and Hebrew queries read
//! the translation's verses directly. Either way every match is checked here.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::canon;
use crate::scripture::reference::{verse_key, ScriptureRef, ScriptureRefDto};

/// Above this many verses, matches are listed one book at a time.
pub const INLINE_VERSES: usize = 200;
/// The most verses one book's list returns (no book has more verses).
pub const BOOK_VERSES_LIMIT: usize = 3_000;
/// The longest query read.
pub const QUERY_MAX_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConcordanceMode {
    Word,
    Phrase,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceQuery {
    pub translation_id: String,
    pub query: String,
    pub mode: ConcordanceMode,
    /// Only this book's verses (canonical code); the counts stay for the whole Bible.
    #[serde(default)]
    pub book: Option<String>,
}

/// One verse that contains the query, with where (UTF-16 offsets into `text`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceHit {
    pub reference: ScriptureRefDto,
    pub text: String,
    pub matches: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceBook {
    pub code: String,
    pub name: String,
    pub verses: usize,
    pub occurrences: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConcordanceResult {
    pub query: String,
    pub mode: ConcordanceMode,
    pub translation_id: String,
    pub verses: usize,
    pub occurrences: usize,
    /// In canonical order, only books with matches.
    pub books: Vec<ConcordanceBook>,
    /// Every matching verse when there are few (or the one book asked for);
    /// otherwise empty, and each book's verses are asked for on their own.
    pub hits: Vec<ConcordanceHit>,
    pub hits_complete: bool,
}

/// A token of a text: where it is (UTF-16, end exclusive) and its normalised form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub start: usize,
    pub end: usize,
    pub form: String,
}

fn is_token_char(c: char) -> bool {
    c.is_alphanumeric() || is_combining_mark(c)
}

fn is_greek(c: char) -> bool {
    matches!(c, '\u{0370}'..='\u{03FF}' | '\u{1F00}'..='\u{1FFF}')
}

fn is_hebrew(c: char) -> bool {
    matches!(c, '\u{0590}'..='\u{05FF}' | '\u{FB1D}'..='\u{FB4F}')
}

/// The form a token is compared by (see the module notes).
pub fn normalize(token: &str) -> String {
    if token.is_ascii() {
        return token.to_ascii_lowercase();
    }
    let lower: String = token.nfc().collect::<String>().to_lowercase();
    if lower.chars().any(is_greek) {
        let bare: String = lower.nfd().filter(|c| !is_combining_mark(*c)).collect();
        return bare.replace('ς', "σ").nfc().collect();
    }
    if lower.chars().any(is_hebrew) {
        // Presentation forms (e.g. U+FB2A) decompose to letter + point first.
        return lower
            .nfd()
            .filter(|c| !is_combining_mark(*c))
            .collect::<String>()
            .nfc()
            .collect();
    }
    lower
}

/// The tokens of a text, in order.
pub fn tokens(text: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut at16 = 0usize;
    let mut current: Option<(usize, String)> = None;
    for c in text.chars() {
        if is_token_char(c) {
            match &mut current {
                Some((_, s)) => s.push(c),
                None => current = Some((at16, c.to_string())),
            }
        } else if let Some((start, s)) = current.take() {
            out.push(Token {
                start,
                end: at16,
                form: normalize(&s),
            });
        }
        at16 += c.len_utf16();
    }
    if let Some((start, s)) = current {
        out.push(Token {
            start,
            end: at16,
            form: normalize(&s),
        });
    }
    out
}

/// Where the query's tokens occur in a text, consecutively: (start, end) per occurrence.
pub fn find(text: &str, query: &[String]) -> Vec<(usize, usize)> {
    if query.is_empty() {
        return Vec::new();
    }
    let toks = tokens(text);
    let n = query.len();
    let mut out = Vec::new();
    let mut i = 0;
    while i + n <= toks.len() {
        if toks[i..i + n].iter().zip(query).all(|(t, q)| &t.form == q) {
            out.push((toks[i].start, toks[i + n - 1].end));
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

fn invalid(key: &'static str, message: &str) -> AppError {
    AppError::InvalidInput(UserMessage::new(key, message))
}

/// The query's tokens, checked against the mode.
pub fn query_tokens(query: &str, mode: ConcordanceMode) -> AppResult<Vec<String>> {
    let query: String = query.chars().take(QUERY_MAX_CHARS).collect();
    let found: Vec<String> = tokens(&query).into_iter().map(|t| t.form).collect();
    if found.is_empty() {
        return Err(invalid("concordance.empty", "Type a word to look for."));
    }
    if mode == ConcordanceMode::Word && found.len() > 1 {
        return Err(invalid(
            "concordance.notOneWord",
            "That is more than one word. Choose Phrase to look for words together.",
        ));
    }
    Ok(found)
}

/// Whether the full-text index can narrow the verses for these tokens without
/// losing any (its matching is looser than ours for Latin and Hangul only).
fn index_can_narrow(tokens: &[String]) -> bool {
    tokens.iter().all(|t| {
        t.chars()
            .all(|c| !is_greek(c) && !is_hebrew(c) && !is_combining_mark(c))
    })
}

/// A matching verse: its key, its text and where the query is in it.
type Found = (i64, String, Vec<(usize, usize)>);

fn split_key(key: i64) -> (u8, u16, u16) {
    (
        (key / 1_000_000) as u8,
        ((key / 1000) % 1000) as u16,
        (key % 1000) as u16,
    )
}

/// Looks for a word or phrase in one translation (see the module notes).
pub fn search(conn: &Connection, input: &ConcordanceQuery) -> AppResult<ConcordanceResult> {
    let wanted = query_tokens(&input.query, input.mode)?;
    crate::db::bibles::get(conn, &input.translation_id)?;
    let only_book = match input.book.as_deref().filter(|b| !b.is_empty()) {
        Some(code) => Some(
            canon::by_code(code)
                .ok_or_else(|| invalid("reference.notABook", "That is not a book of the Bible."))?,
        ),
        None => None,
    };

    // The verses to read: narrowed by the index where that is safe, else all of the translation's.
    let rows: Vec<(i64, String)> = if index_can_narrow(&wanted) {
        let phrase = format!("\"{}\"", wanted.join(" ").replace('"', ""));
        let mut stmt = conn.prepare(
            "SELECT t.verse_id, t.text FROM bible_verse_search s
             JOIN bible_verse_texts t ON t.id = s.rowid
             WHERE bible_verse_search MATCH ?1 AND t.translation_id = ?2
             ORDER BY t.verse_id",
        )?;
        let rows = stmt.query_map(params![phrase, input.translation_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;
        rows.collect::<Result<_, _>>()?
    } else {
        let mut stmt = conn.prepare(
            "SELECT verse_id, text FROM bible_verse_texts WHERE translation_id = ?1 ORDER BY verse_id",
        )?;
        let rows = stmt.query_map([&input.translation_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };

    let mut by_book: BTreeMap<u8, (usize, usize)> = BTreeMap::new();
    let mut found: Vec<Found> = Vec::new();
    for (key, text) in rows {
        let matches = find(&text, &wanted);
        if matches.is_empty() {
            continue;
        }
        let (ordinal, _, _) = split_key(key);
        let entry = by_book.entry(ordinal).or_default();
        entry.0 += 1;
        entry.1 += matches.len();
        found.push((key, text, matches));
    }

    let verses: usize = by_book.values().map(|v| v.0).sum();
    let occurrences: usize = by_book.values().map(|v| v.1).sum();
    let books = by_book
        .iter()
        .filter_map(|(ordinal, (v, o))| {
            canon::by_ordinal(*ordinal).map(|b| ConcordanceBook {
                code: b.code.to_string(),
                name: b.name.to_string(),
                verses: *v,
                occurrences: *o,
            })
        })
        .collect();

    let (listed, hits_complete): (Vec<_>, bool) = match only_book {
        Some(book) => {
            let low = verse_key(book.ordinal, 0, 0);
            let high = verse_key(book.ordinal, 999, 999);
            let mine: Vec<_> = found
                .into_iter()
                .filter(|(k, _, _)| (low..=high).contains(k))
                .collect();
            let complete = mine.len() <= BOOK_VERSES_LIMIT;
            (mine.into_iter().take(BOOK_VERSES_LIMIT).collect(), complete)
        }
        None if verses <= INLINE_VERSES => (found, true),
        None => (Vec::new(), false),
    };
    let mut hits = Vec::with_capacity(listed.len());
    for (key, text, matches) in listed {
        let (ordinal, chapter, verse) = split_key(key);
        let Some(book) = canon::by_ordinal(ordinal) else {
            continue;
        };
        let reference = ScriptureRef::verse(book, chapter, verse)?;
        hits.push(ConcordanceHit {
            reference: reference.to_dto(),
            text,
            matches,
        });
    }
    Ok(ConcordanceResult {
        query: input.query.clone(),
        mode: input.mode,
        translation_id: input.translation_id.clone(),
        verses,
        occurrences,
        books,
        hits,
        hits_complete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(s: &str) -> Vec<String> {
        query_tokens(s, ConcordanceMode::Phrase).unwrap()
    }

    #[test]
    fn whole_words_only() {
        assert_eq!(find("By grace, not disgrace.", &q("grace")).len(), 1);
        assert!(find("the other", &q("he")).is_empty());
        assert_eq!(find("Grace and GRACE", &q("grace")).len(), 2);
    }

    #[test]
    fn phrases_are_consecutive_tokens_across_punctuation() {
        assert_eq!(
            find("saved by grace, through faith", &q("by grace")),
            vec![(6, 14)]
        );
        assert!(find("by the grace", &q("by grace")).is_empty());
    }

    #[test]
    fn latin_accents_are_kept() {
        assert_eq!(find("Il est élu.", &q("élu")).len(), 1);
        assert!(find("Il est élu.", &q("elu")).is_empty());
        assert!(find("über alles", &q("uber")).is_empty());
        // composed and decomposed spellings are the same
        assert_eq!(find("Il est e\u{301}lu.", &q("élu")).len(), 1);
    }

    #[test]
    fn greek_ignores_accents_and_final_sigma() {
        assert_eq!(normalize("Λόγος"), normalize("λογος"));
        assert_eq!(normalize("ἀγάπη"), "αγαπη");
        assert_eq!(find("ἐν ἀρχῇ ἦν ὁ λόγος", &q("λογος")).len(), 1);
    }

    #[test]
    fn hebrew_ignores_points_and_maqaf_separates() {
        assert_eq!(normalize("בְּרֵאשִׁית"), normalize("בראשית"));
        assert_eq!(find("אֶת־הָאָרֶץ", &q("הארץ")).len(), 1);
    }

    #[test]
    fn korean_is_the_exact_written_word() {
        assert_eq!(find("은혜를 받았다", &q("은혜를")).len(), 1);
        assert!(find("은혜를 받았다", &q("은혜")).is_empty());
    }

    #[test]
    fn offsets_are_utf16() {
        assert_eq!(find("𝔄 grace", &q("grace")), vec![(3, 8)]);
    }

    #[test]
    fn word_mode_wants_one_word() {
        assert!(query_tokens("by grace", ConcordanceMode::Word).is_err());
        assert!(query_tokens(" ,. ", ConcordanceMode::Word).is_err());
    }
}
