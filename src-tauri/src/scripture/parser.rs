//! Deterministic Bible reference parsing and detection.
//!
//! One [`ReferenceParser`] reads **one language**: its alias dictionary (book
//! names and abbreviations → canonical book) and its notation (`Joh 3,16`,
//! `John 3:16`, `요한복음 3장 16절`). Dictionaries are never merged: short
//! aliases collide across languages ("Am", "Job", "Mark"), so a parser exists
//! per [`ReferenceLanguage`] ([`ReferenceParser::for_language`], built once and
//! cached) and the caller chooses by the language of the text, never by the
//! interface language.
//!
//! * [`ReferenceParser::parse`] reads a whole input such as `Rom 8:1-17`.
//! * [`ReferenceParser::detect`] finds references inside running text and
//!   reports where they are (UTF-16 offsets, as JavaScript counts them).
//!
//! Detection is conservative: it prefers a missed reference to a false one.
//! A candidate must (a) be a real passage of the canon, (b) satisfy the
//! language's own false-positive policy (Latin scripts: the book name starts
//! with a capital letter or a digit; Korean: it stands on its own and an
//! abbreviation that is also a common word needs a full chapter-and-verse
//! form), and (c) stand on word boundaries.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

mod context;
pub use context::{
    ContextTracker, OuterContext, ParagraphReferences, PAGE_LOOKBACK, SECTION_LOOKBACK,
};

use regex::{Captures, Regex};
use serde::Serialize;

use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::canon::{Book, BOOKS};
use crate::scripture::language::{fold, ReferenceLanguage};
use crate::scripture::reference::{Point, ScriptureRef, ScriptureRefDto};

/// How much of a reference an alias must be written with to count.
///
/// Full names are safe anywhere. A short abbreviation that is also an
/// ordinary word (Korean 시, 요, 갈…; German Mal) is only trusted with a verse,
/// so "요 3:16" is John but "요 3개" is not, and "Mal 4,3" is Malachi but
/// "Mal 4" is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strictness {
    /// A chapter alone is enough (`요한복음 3`).
    Full,
    /// A chapter needs its unit (`롬 8장`) or a verse (`롬 8:28`).
    Unit,
    /// Only a chapter with a verse counts (`시 23:1`, `시 23장 1절`).
    Verse,
}

/// One alias of a book, in a dictionary.
#[derive(Debug, Clone)]
pub struct AliasEntry {
    pub alias: String,
    pub book: &'static Book,
    pub strictness: Strictness,
}

/// How references are written in a language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grammar {
    /// `Book 3`, `Book 3:16`, `Book 3,16-18`: Latin script, spaces between words.
    Latin,
    /// `요한복음 3:16`, `요한복음 3장 16-18절`, `롬 8장`: Hangul, units 장/편/절.
    Korean,
}

/// The notation of a language.
#[derive(Debug, Clone, Copy)]
pub struct Syntax {
    pub grammar: Grammar,
    /// Regex alternatives that may stand between a chapter and its verse (Latin).
    pub verse_separator: &'static str,
    /// For dictionaries that list numbered books as "1 kor": what may stand
    /// between the number and the name ("1. Kor", "1Kor", "1º Coríntios").
    /// `None` for a dictionary that spells every form out (English).
    pub number_join: Option<&'static str>,
    /// Latin scripts: the book name must start with a capital letter or a digit.
    pub require_capital: bool,
    /// Aliases (as spelled in the dictionary) whose accent-free form is also an
    /// ordinary word, so only the accented spelling counts: German "Röm" must not
    /// make "Rom" (the city) a reference.
    pub no_fold: &'static [&'static str],
}

/// The aliases and notation of one language.
#[derive(Debug, Clone)]
pub struct AliasDictionary {
    pub language: ReferenceLanguage,
    pub entries: Vec<AliasEntry>,
    pub syntax: Syntax,
}

impl AliasDictionary {
    /// English names and abbreviations. Numbered books accept "1", "1st",
    /// "I" and "First" style prefixes, with or without a space after digits.
    /// Very short aliases that are common English words ("is", "am") are
    /// deliberately absent.
    pub fn english() -> Self {
        let mut aliases: Vec<(String, &'static Book)> = Vec::new();
        for book in &BOOKS {
            let mut names = vec![book.base_name().to_lowercase()];
            names.extend(book.aliases.iter().map(|a| a.to_string()));
            match book.number {
                None => aliases.extend(names.into_iter().map(|n| (n, book))),
                Some(number) => {
                    let (ordinal, roman, word) = match number {
                        1 => ("1st", "i", "first"),
                        2 => ("2nd", "ii", "second"),
                        _ => ("3rd", "iii", "third"),
                    };
                    let digit = number.to_string();
                    for name in names {
                        for prefix in [digit.as_str(), ordinal] {
                            aliases.push((format!("{prefix} {name}"), book));
                            aliases.push((format!("{prefix}{name}"), book));
                        }
                        for prefix in [roman, word] {
                            aliases.push((format!("{prefix} {name}"), book));
                        }
                    }
                }
            }
        }
        aliases.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.ordinal.cmp(&b.1.ordinal)));
        aliases.dedup_by(|a, b| a.0 == b.0 && a.1.ordinal == b.1.ordinal);
        Self {
            language: ReferenceLanguage::En,
            entries: aliases
                .into_iter()
                .map(|(alias, book)| AliasEntry {
                    alias,
                    book,
                    strictness: Strictness::Full,
                })
                .collect(),
            syntax: Syntax {
                grammar: Grammar::Latin,
                verse_separator: r"\s*:\s*|\.",
                number_join: None,
                require_capital: true,
                no_fold: &[],
            },
        }
    }

    /// Aliases that point at more than one book once normalised, as
    /// `(alias, codes)`. A dictionary must have none (tested per language).
    pub fn collisions(&self) -> Vec<(String, Vec<&'static str>)> {
        let mut seen: HashMap<String, Vec<&'static str>> = HashMap::new();
        for entry in &self.entries {
            let key = key_of(&self.syntax, &entry.alias);
            let codes = seen.entry(key).or_default();
            if !codes.contains(&entry.book.code) {
                codes.push(entry.book.code);
            }
        }
        let mut out: Vec<_> = seen.into_iter().filter(|(_, c)| c.len() > 1).collect();
        out.sort();
        out
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

/// The dictionary key of an alias or of a matched book name: [`normalise`],
/// and for dictionaries that join numbers loosely, "1kor" → "1 kor" and
/// "1º" → "1".
fn key_of(syntax: &Syntax, text: &str) -> String {
    if syntax.number_join.is_none() {
        return normalise(text);
    }
    let cleaned = text.replace(['º', '°'], " ");
    let spaced = normalise(&cleaned);
    // "1kor": a digit run stuck to the name.
    let digits = spaced.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && spaced.len() > digits && !spaced[digits..].starts_with(' ') {
        format!("{} {}", &spaced[..digits], &spaced[digits..])
    } else {
        spaced
    }
}

fn is_number_token(token: &str) -> bool {
    !token.is_empty()
        && (token.chars().all(|c| c.is_ascii_digit()) || matches!(token, "i" | "ii" | "iii"))
}

fn is_roman(token: &str) -> bool {
    matches!(token, "i" | "ii" | "iii")
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

#[derive(Debug, Clone, Copy)]
struct Target {
    book: &'static Book,
    strictness: Strictness,
}

pub struct ReferenceParser {
    language: ReferenceLanguage,
    syntax: Syntax,
    pattern: Regex,
    lookup: HashMap<String, Target>,
}

/// What was written after the book name.
struct Parts {
    c1: u16,
    v1: Option<u16>,
    n2: Option<u16>,
    v2: Option<u16>,
    /// A chapter unit followed the number (Korean 장, 편).
    chapter_unit: bool,
    /// A verse unit followed the number (Korean 절) with no chapter before it.
    verse_unit: bool,
}

impl ReferenceParser {
    /// Builds the parser of one dictionary.
    pub fn new(dictionary: AliasDictionary) -> Self {
        let AliasDictionary {
            language,
            entries,
            syntax,
        } = dictionary;

        let mut lookup: HashMap<String, Target> = HashMap::new();
        for entry in &entries {
            lookup
                .entry(key_of(&syntax, &entry.alias))
                .or_insert(Target {
                    book: entry.book,
                    strictness: entry.strictness,
                });
        }
        // Accent-free spellings ("Roemer"-style transliterations aside, "Coríntios"
        // → "Corintios") are accepted only where they cannot be another book's
        // own spelling and do not point at two books themselves.
        if syntax.grammar == Grammar::Latin {
            let mut folded: HashMap<String, Vec<Target>> = HashMap::new();
            for entry in entries
                .iter()
                .filter(|e| !syntax.no_fold.contains(&e.alias.as_str()))
            {
                let key = fold(&key_of(&syntax, &entry.alias));
                folded.entry(key).or_default().push(Target {
                    book: entry.book,
                    strictness: entry.strictness,
                });
            }
            for (key, targets) in folded {
                let first = targets[0];
                if targets.iter().all(|t| t.book.code == first.book.code)
                    && !lookup.contains_key(&key)
                {
                    lookup.insert(key, first);
                }
            }
        }

        // Longest aliases first, so "1 john" wins over "john".
        let mut keys: Vec<&String> = lookup.keys().collect();
        keys.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
        let alternatives = keys
            .iter()
            .map(|key| alias_pattern(&syntax, key))
            .collect::<Vec<_>>()
            .join("|");

        let pattern = match syntax.grammar {
            Grammar::Latin => latin_pattern(&alternatives, syntax.verse_separator),
            Grammar::Korean => korean_pattern(&alternatives),
        };
        Self {
            language,
            syntax,
            pattern: Regex::new(&pattern).expect("reference pattern is valid"),
            lookup,
        }
    }

    /// The parser of one language, built once and shared.
    pub fn for_language(language: ReferenceLanguage) -> &'static ReferenceParser {
        static PARSERS: [OnceLock<ReferenceParser>; 6] = [
            OnceLock::new(),
            OnceLock::new(),
            OnceLock::new(),
            OnceLock::new(),
            OnceLock::new(),
            OnceLock::new(),
        ];
        let slot = match language {
            ReferenceLanguage::En => 0,
            ReferenceLanguage::De => 1,
            ReferenceLanguage::Ko => 2,
            ReferenceLanguage::Fr => 3,
            ReferenceLanguage::Es => 4,
            ReferenceLanguage::Pt => 5,
        };
        PARSERS[slot]
            .get_or_init(|| ReferenceParser::new(crate::scripture::aliases::dictionary(language)))
    }

    /// The shared English parser (typed navigation, studies and the default
    /// for a source with no recognised language).
    pub fn english() -> &'static ReferenceParser {
        Self::for_language(ReferenceLanguage::En)
    }

    pub fn language(&self) -> ReferenceLanguage {
        self.language
    }

    /// Parses input that is exactly one reference, e.g. typed navigation.
    /// A bare book name opens its first chapter.
    pub fn parse(&self, input: &str) -> AppResult<ScriptureRef> {
        let text = input.trim().trim_end_matches(['.', ',', ';']);
        if text.is_empty() {
            return Err(AppError::InvalidReference(UserMessage::new(
                "reference.empty",
                "Type a passage, for example “John 15” or “Rom 8:1-17”.",
            )));
        }
        if let Some(target) = self.lookup.get(&key_of(&self.syntax, text)) {
            return ScriptureRef::chapter(target.book, 1);
        }
        match self.pattern.captures(text) {
            Some(caps)
                if caps
                    .get(0)
                    .is_some_and(|m| m.start() == 0 && m.end() == text.len()) =>
            {
                self.interpret(&caps)
            }
            _ => Err(AppError::InvalidReference(
                UserMessage::new(
                    "reference.notRecognised",
                    format!(
                        "“{}” is not a passage I recognise. Try a form like “John 15” or “Rom 8:1-17”.",
                        input.trim()
                    ),
                )
                .with("text", input.trim()),
            )),
        }
    }

    /// Finds valid references in running text, under this language's
    /// false-positive policy (see the module notes).
    pub fn detect(&self, text: &str) -> Vec<DetectedReference> {
        self.pattern
            .captures_iter(text)
            .filter(|caps| self.accepts(text, caps))
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

    fn target(&self, caps: &Captures) -> Option<Target> {
        let book = caps.name("book")?.as_str();
        self.lookup.get(&key_of(&self.syntax, book)).copied()
    }

    /// The language's false-positive policy for one candidate.
    fn accepts(&self, text: &str, caps: &Captures) -> bool {
        let (Some(whole), Some(book), Some(target)) =
            (caps.get(0), caps.name("book"), self.target(caps))
        else {
            return false;
        };
        match self.syntax.grammar {
            Grammar::Latin => {
                // Stands on its own: not inside a longer word (the ASCII boundary
                // in the pattern cannot see accented letters), and not followed by one.
                let before = text[..whole.start()].chars().next_back();
                let after = text[whole.end()..].chars().next();
                if before.is_some_and(|c| c.is_alphanumeric() || c == '_')
                    || after.is_some_and(|c| c.is_alphanumeric() || c == '_')
                {
                    return false;
                }
                let capital = !self.syntax.require_capital
                    || book
                        .as_str()
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_uppercase() || c.is_ascii_digit());
                // Latin scripts have no chapter unit, so an alias that is also an
                // ordinary word (German "Mal") needs its verse: "Mal 4,3", never "Mal 4".
                capital
                    && match target.strictness {
                        Strictness::Full => true,
                        Strictness::Unit | Strictness::Verse => caps.name("v1").is_some(),
                    }
            }
            Grammar::Korean => {
                // Stands on its own: not inside a longer word, not followed by more digits.
                let before = text[..whole.start()].chars().next_back();
                if before.is_some_and(|c| c.is_alphanumeric()) {
                    return false;
                }
                let after = text[whole.end()..].chars().next();
                if after.is_some_and(|c| c.is_ascii_digit()) {
                    return false;
                }
                let parts = korean_parts(caps);
                let has_verse = parts.v1.is_some();
                let has_unit = parts.chapter_unit || parts.verse_unit;
                let enough = match target.strictness {
                    Strictness::Full => true,
                    Strictness::Unit => has_verse || has_unit,
                    Strictness::Verse => has_verse,
                };
                if !enough {
                    return false;
                }
                // A bare number straight into more Korean ("3권", "3명") is not a chapter.
                if !has_verse && !has_unit {
                    return !after.is_some_and(is_hangul);
                }
                // 절 (verse) only makes sense where there is one chapter to count in.
                if parts.verse_unit && target.book.chapter_count != 1 {
                    return false;
                }
                true
            }
        }
    }

    fn interpret(&self, caps: &Captures) -> AppResult<ScriptureRef> {
        let book_text = caps.name("book").map_or("", |m| m.as_str());
        let book = self.target(caps).map(|t| t.book).ok_or_else(|| {
            AppError::InvalidReference(
                UserMessage::new(
                    "reference.unknownBook",
                    format!("Unknown book “{book_text}”."),
                )
                .with("text", book_text),
            )
        })?;
        let parts = match self.syntax.grammar {
            Grammar::Latin => {
                let number =
                    |name: &str| caps.name(name).and_then(|m| m.as_str().parse::<u16>().ok());
                Parts {
                    c1: number("c1").unwrap_or(0),
                    v1: number("v1"),
                    n2: number("n2"),
                    v2: number("v2"),
                    chapter_unit: false,
                    verse_unit: false,
                }
            }
            Grammar::Korean => korean_parts(caps),
        };
        let Parts {
            c1,
            v1,
            n2,
            v2,
            chapter_unit,
            ..
        } = parts;
        let one_chapter = book.chapter_count == 1;
        let at = |chapter, verse| Point { chapter, verse };

        let (start, end) = match (v1, n2, v2) {
            // "Jude 3" is verse 3 of the only chapter; "John 3" is a chapter
            // (and so is "유다서 1장", which names its unit).
            (None, None, _) if one_chapter && !chapter_unit => (at(1, Some(c1)), at(1, Some(c1))),
            (None, None, _) => (at(c1, None), at(c1, None)),
            (Some(v), None, _) => (at(c1, Some(v)), at(c1, Some(v))),
            (Some(v), Some(to), None) => (at(c1, Some(v)), at(c1, Some(to))),
            (Some(v), Some(c2), Some(v2)) => (at(c1, Some(v)), at(c2, Some(v2))),
            (None, Some(to), None) if one_chapter && !chapter_unit => {
                (at(1, Some(c1)), at(1, Some(to)))
            }
            (None, Some(to), None) => (at(c1, None), at(to, None)),
            (None, Some(c2), Some(v2)) => (at(c1, None), at(c2, Some(v2))),
        };
        ScriptureRef::new(book, start, end)
    }
}

/// The regex fragment for one dictionary key. A Latin-script alias that starts
/// with an ASCII letter or digit is preceded by an ASCII word boundary; one that
/// starts with an accented letter ("Éz") cannot be (an ASCII boundary does not
/// see it), and neither kind may rely on a Unicode `\b`: with one, the regex
/// engine gives up its fast path on any text containing a non-ASCII character
/// (a curly quote will do) and reads three to ten times slower. The letters
/// around a candidate are checked in [`ReferenceParser::accepts`] instead.
fn alias_pattern(syntax: &Syntax, key: &str) -> String {
    let body = alias_body(syntax, key);
    let ascii_start = key
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric());
    if syntax.grammar == Grammar::Latin && ascii_start {
        format!(r"(?-u:\b){body}")
    } else {
        body
    }
}

fn alias_body(syntax: &Syntax, key: &str) -> String {
    let tokens: Vec<&str> = key.split(' ').collect();
    if let (Some(join), true) = (
        syntax.number_join,
        tokens.len() > 1 && is_number_token(tokens[0]),
    ) {
        // "1 kor" also reads "1. Kor", "1Kor", "1º Coríntios"; a Roman numeral needs a break.
        let join = if is_roman(tokens[0]) { r"\.?\s+" } else { join };
        let rest = tokens[1..]
            .iter()
            .map(|t| regex::escape(t))
            .collect::<Vec<_>>()
            .join(r"\s+");
        return format!("{}{join}{rest}", regex::escape(tokens[0]));
    }
    tokens
        .iter()
        .map(|t| regex::escape(t))
        .collect::<Vec<_>>()
        .join(r"\s+")
}

/// Chapter and verse are separated by the language's separators (spaces
/// allowed around ":"; "." and "," only between digits, so a sentence ending
/// "John 3. 16 people" or "Joh 3, 16 Personen" is not read as a verse).
fn latin_pattern(alternatives: &str, separator: &str) -> String {
    format!(
        r"(?i)(?P<book>{alternatives})\.?\s*(?P<c1>\d{{1,3}})(?:(?:{separator})(?P<v1>\d{{1,3}}))?(?:\s*[-‐‑‒–—]\s*(?P<n2>\d{{1,3}})(?:(?:{separator})(?P<v2>\d{{1,3}}))?)?(?-u:\b)"
    )
}

/// Korean: `3:16`, `3:16-18`, `3장 16절`, `3장 16-18절`, `3장 16절-4장 2절`,
/// `3-4장`, `3장`, `23편`, `3`, and `절` alone for one-chapter books.
fn korean_pattern(alternatives: &str) -> String {
    const DASH: &str = r"[-~‐‑‒–—]";
    format!(
        r"(?P<book>{alternatives})\s*(?P<c1>\d{{1,3}})(?:\s*:\s*(?P<v1>\d{{1,3}})(?:\s*{DASH}\s*(?P<n2>\d{{1,3}})(?:\s*:\s*(?P<v2>\d{{1,3}}))?)?\s*(?:절)?|\s*장\s*(?P<v1k>\d{{1,3}})\s*절(?:\s*{DASH}\s*(?P<n2k>\d{{1,3}})(?:\s*(?:장\s*(?P<v2k>\d{{1,3}}))?\s*절))?|\s*장\s*(?P<v1c>\d{{1,3}})\s*{DASH}\s*(?P<n2c>\d{{1,3}})\s*절|\s*{DASH}\s*(?P<n2d>\d{{1,3}})\s*(?P<unitd>[장편절])?|\s*(?P<unit>[장편절]))?"
    )
}

fn korean_parts(caps: &Captures) -> Parts {
    let number = |names: &[&str]| {
        names
            .iter()
            .find_map(|n| caps.name(n))
            .and_then(|m| m.as_str().parse::<u16>().ok())
    };
    let unit = |name: &str| caps.name(name).map(|m| m.as_str());
    let whole = caps.get(0).map_or("", |m| m.as_str());
    let verse_form = caps.name("v1k").is_some() || caps.name("v1c").is_some();
    let verse_unit = matches!(unit("unit"), Some("절")) || matches!(unit("unitd"), Some("절"));
    let chapter_unit = verse_form
        || matches!(unit("unit"), Some("장" | "편"))
        || matches!(unit("unitd"), Some("장" | "편"))
        || (whole.contains('장') && !verse_unit);
    Parts {
        c1: number(&["c1"]).unwrap_or(0),
        v1: number(&["v1", "v1k", "v1c"]),
        n2: number(&["n2", "n2k", "n2c", "n2d"]),
        v2: number(&["v2", "v2k"]),
        chapter_unit,
        verse_unit,
    }
}

fn is_hangul(c: char) -> bool {
    matches!(c, '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}' | '\u{AC00}'..='\u{D7AF}')
}

fn utf16_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].encode_utf16().count()
}

/// Aliases that are the same once accents are ignored but point at different
/// books: reported so a dictionary can be checked.
pub fn accent_collisions(dictionary: &AliasDictionary) -> Vec<String> {
    let mut seen: HashMap<String, HashSet<&'static str>> = HashMap::new();
    for entry in &dictionary.entries {
        seen.entry(fold(&key_of(&dictionary.syntax, &entry.alias)))
            .or_default()
            .insert(entry.book.code);
    }
    let mut out: Vec<String> = seen
        .into_iter()
        .filter(|(_, codes)| codes.len() > 1)
        .map(|(key, _)| key)
        .collect();
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_english_alias_points_at_two_books() {
        assert!(AliasDictionary::english().collisions().is_empty());
    }
}
