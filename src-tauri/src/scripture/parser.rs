//! Deterministic Bible reference parsing and detection.
//!
//! One regular expression is built from an alias dictionary (book names and
//! abbreviations → canonical book). English is the first dictionary; another
//! language adds its own [`AliasDictionary`] and reuses everything else.
//!
//! * [`ReferenceParser::parse`] reads a whole input such as `Rom 8:1-17`.
//! * [`ReferenceParser::detect`] finds references inside running text and
//!   reports where they are (UTF-16 offsets, as JavaScript counts them).

use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::scripture::canon::{Book, BOOKS};
use crate::scripture::reference::{Point, ScriptureRef, ScriptureRefDto};

/// Book aliases for one language, already normalised (see [`normalise`]).
pub struct AliasDictionary {
    pub language: &'static str,
    pub entries: Vec<(String, &'static Book)>,
}

impl AliasDictionary {
    /// English names and abbreviations. Numbered books accept "1", "1st",
    /// "I" and "First" style prefixes, with or without a space after digits.
    /// Very short aliases that are common English words ("is", "am") are
    /// deliberately absent.
    pub fn english() -> Self {
        let mut entries = Vec::new();
        for book in &BOOKS {
            let mut names = vec![book.base_name().to_lowercase()];
            names.extend(book.aliases.iter().map(|a| a.to_string()));
            match book.number {
                None => entries.extend(names.into_iter().map(|n| (n, book))),
                Some(number) => {
                    let (ordinal, roman, word) = match number {
                        1 => ("1st", "i", "first"),
                        2 => ("2nd", "ii", "second"),
                        _ => ("3rd", "iii", "third"),
                    };
                    let digit = number.to_string();
                    for name in names {
                        for prefix in [digit.as_str(), ordinal] {
                            entries.push((format!("{prefix} {name}"), book));
                            entries.push((format!("{prefix}{name}"), book));
                        }
                        for prefix in [roman, word] {
                            entries.push((format!("{prefix} {name}"), book));
                        }
                    }
                }
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.ordinal.cmp(&b.1.ordinal)));
        entries.dedup_by(|a, b| a.0 == b.0 && a.1.ordinal == b.1.ordinal);
        Self {
            language: "en",
            entries,
        }
    }
}

/// Lower case, no full stops, single spaces.
pub fn normalise(alias: &str) -> String {
    alias
        .to_lowercase()
        .replace('.', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A reference found inside a longer text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedReference {
    pub text: String,
    /// UTF-16 code-unit offsets into the input, end exclusive.
    pub start: usize,
    pub end: usize,
    pub reference: ScriptureRefDto,
}

pub struct ReferenceParser {
    pattern: Regex,
    lookup: HashMap<String, &'static Book>,
}

impl ReferenceParser {
    pub fn new(dictionaries: &[AliasDictionary]) -> Self {
        let mut lookup = HashMap::new();
        for dictionary in dictionaries {
            for (alias, book) in &dictionary.entries {
                lookup.insert(normalise(alias), *book);
            }
        }
        // Longest aliases first, so "1 john" wins over "john".
        let mut aliases: Vec<&String> = lookup.keys().collect();
        aliases.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
        let alternatives = aliases
            .iter()
            .map(|alias| {
                alias
                    .split(' ')
                    .map(regex::escape)
                    .collect::<Vec<_>>()
                    .join(r"\s+")
            })
            .collect::<Vec<_>>()
            .join("|");
        // Chapter and verse are separated by ":" (spaces allowed) or "."
        // (no spaces, so a sentence ending "John 3. 16 people" is not read
        // as John 3:16).
        let pattern = format!(
            r"(?i)\b(?P<book>{alternatives})\.?\s*(?P<c1>\d{{1,3}})(?:(?:\s*:\s*|\.)(?P<v1>\d{{1,3}}))?(?:\s*[-‐‑‒–—]\s*(?P<n2>\d{{1,3}})(?:(?:\s*:\s*|\.)(?P<v2>\d{{1,3}}))?)?\b"
        );
        Self {
            pattern: Regex::new(&pattern).expect("reference pattern is valid"),
            lookup,
        }
    }

    /// The shared English parser.
    pub fn english() -> &'static ReferenceParser {
        static PARSER: OnceLock<ReferenceParser> = OnceLock::new();
        PARSER.get_or_init(|| ReferenceParser::new(&[AliasDictionary::english()]))
    }

    /// Parses input that is exactly one reference, e.g. typed navigation.
    /// A bare book name opens its first chapter.
    pub fn parse(&self, input: &str) -> AppResult<ScriptureRef> {
        let text = input.trim().trim_end_matches(['.', ',', ';']);
        if text.is_empty() {
            return Err(AppError::InvalidReference(
                "Type a passage, for example “John 15” or “Rom 8:1-17”.".into(),
            ));
        }
        if let Some(book) = self.lookup.get(&normalise(text)) {
            return ScriptureRef::chapter(book, 1);
        }
        match self.pattern.captures(text) {
            Some(caps)
                if caps
                    .get(0)
                    .is_some_and(|m| m.start() == 0 && m.end() == text.len()) =>
            {
                self.interpret(&caps)
            }
            _ => Err(AppError::InvalidReference(format!(
                "“{}” is not a passage I recognise. Try a form like “John 15” or “Rom 8:1-17”.",
                input.trim()
            ))),
        }
    }

    /// Finds valid references in running text. A candidate counts only if
    /// its book name starts with a capital letter or a digit (so "mark 4" in
    /// ordinary prose is not a reference) and it is a real passage.
    pub fn detect(&self, text: &str) -> Vec<DetectedReference> {
        self.pattern
            .captures_iter(text)
            .filter(|caps| {
                caps.name("book")
                    .and_then(|m| m.as_str().chars().next())
                    .is_some_and(|c| c.is_uppercase() || c.is_ascii_digit())
            })
            .filter_map(|caps| {
                let whole = caps.get(0)?;
                let reference = self.interpret(&caps).ok()?;
                Some(DetectedReference {
                    text: whole.as_str().to_string(),
                    start: utf16_offset(text, whole.start()),
                    end: utf16_offset(text, whole.end()),
                    reference: reference.to_dto(),
                })
            })
            .collect()
    }

    fn interpret(&self, caps: &regex::Captures) -> AppResult<ScriptureRef> {
        let number = |name: &str| caps.name(name).and_then(|m| m.as_str().parse::<u16>().ok());
        let book_text = caps.name("book").map_or("", |m| m.as_str());
        let book = self
            .lookup
            .get(&normalise(book_text))
            .copied()
            .ok_or_else(|| AppError::InvalidReference(format!("Unknown book “{book_text}”.")))?;
        let c1 = number("c1").unwrap_or(0);
        let (v1, n2, v2) = (number("v1"), number("n2"), number("v2"));
        let one_chapter = book.chapter_count == 1;
        let at = |chapter, verse| Point { chapter, verse };

        let (start, end) = match (v1, n2, v2) {
            // "Jude 3" is verse 3 of the only chapter; "John 3" is a chapter.
            (None, None, _) if one_chapter => (at(1, Some(c1)), at(1, Some(c1))),
            (None, None, _) => (at(c1, None), at(c1, None)),
            (Some(v), None, _) => (at(c1, Some(v)), at(c1, Some(v))),
            (Some(v), Some(to), None) => (at(c1, Some(v)), at(c1, Some(to))),
            (Some(v), Some(c2), Some(v2)) => (at(c1, Some(v)), at(c2, Some(v2))),
            (None, Some(to), None) if one_chapter => (at(1, Some(c1)), at(1, Some(to))),
            (None, Some(to), None) => (at(c1, None), at(to, None)),
            (None, Some(c2), Some(v2)) => (at(c1, None), at(c2, Some(v2))),
        };
        ScriptureRef::new(book, start, end)
    }
}

fn utf16_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_alias_points_at_two_books() {
        let mut seen: HashMap<String, &str> = HashMap::new();
        for (alias, book) in AliasDictionary::english().entries {
            if let Some(other) = seen.insert(normalise(&alias), book.code) {
                assert_eq!(other, book.code, "alias {alias:?} is ambiguous");
            }
        }
    }
}
