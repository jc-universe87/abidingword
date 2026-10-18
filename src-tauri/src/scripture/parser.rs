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
    document_context, heading_context, heading_line, ContextTracker, OuterContext,
    ParagraphReferences, LOCAL_HEADING_SPAN, MAIN_PASSAGE_KINDS, OPENING_CHARS, OPENING_PARAGRAPHS,
    PAGE_LOOKBACK, SECTION_LOOKBACK,
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
    /// A generated pack (`scripture::data_packs`): `Book 3:16`, `Book 3,16`,
    /// `Book 3.16`, and where the language counts with units, `书 3章16节`.
    Data,
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
    /// Words are separated by spaces, so a book name must not touch a letter
    /// before it (not so in Chinese, Japanese, Thai, Khmer, Burmese).
    pub spaced: bool,
    /// Data grammar: words that may follow a chapter (章, บทที่) or a verse (節).
    pub chapter_units: &'static [&'static str],
    pub verse_units: &'static [&'static str],
}

/// The aliases and notation of one language.
#[derive(Debug, Clone)]
pub struct AliasDictionary {
    pub language: ReferenceLanguage,
    pub entries: Vec<AliasEntry>,
    pub syntax: Syntax,
    /// Spellings that name two books in this language (generated packs): never
    /// read as either; typed alone, they ask which book is meant.
    pub ambiguous: Vec<(String, Vec<&'static Book>)>,
}

/// Characters a reference is read without: zero-width marks, Arabic short
/// vowels and tatweel, Hebrew points. Removed from typed input, from running
/// text before matching, and from every alias, so a vocalised and a plain
/// spelling are one.
fn is_ignorable(c: char) -> bool {
    matches!(c,
        '\u{200B}'..='\u{200F}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}'
        | '\u{064B}'..='\u{065F}' | '\u{0670}' | '\u{0640}'
        | '\u{0591}'..='\u{05BD}' | '\u{05BF}' | '\u{05C1}'..='\u{05C2}' | '\u{05C4}'..='\u{05C7}')
}

/// The zero of each run of decimal digits that Bible references are written
/// with: Arabic-Indic, Extended Arabic-Indic (Persian, Urdu), Devanagari,
/// Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam,
/// Sinhala, Thai, Lao, Tibetan, Myanmar, Khmer, Ol Chiki, full-width.
const DIGIT_ZEROS: &[u32] = &[
    0x0660, 0x06F0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0DE6,
    0x0E50, 0x0ED0, 0x0F20, 0x1040, 0x17E0, 0x1C50, 0xFF10,
];

/// A Unicode decimal digit of an accepted script as its ASCII digit.
pub fn ascii_digit(c: char) -> Option<char> {
    if c.is_ascii_digit() {
        return Some(c);
    }
    let code = c as u32;
    DIGIT_ZEROS
        .iter()
        .find(|zero| (**zero..**zero + 10).contains(&code))
        .and_then(|zero| char::from_digit(code - zero, 10))
}

/// One character as references are read: an accepted digit as ASCII, the
/// full-width and Arabic forms of `:`, `,`, `.`, `-` as ASCII, an ignorable
/// mark as nothing.
fn prepared_char(c: char) -> Option<char> {
    if is_ignorable(c) {
        return None;
    }
    if let Some(d) = ascii_digit(c) {
        return Some(d);
    }
    Some(match c {
        '：' | '﹕' => ':',
        '，' | '،' => ',',
        '．' => '.',
        '－' => '-',
        other => other,
    })
}

/// Text as references are read ([`prepared_char`]), with, for each byte of the
/// result, the byte of the original it came from (one past the end included).
pub struct Prepared {
    pub text: String,
    map: Option<Vec<usize>>,
}

impl Prepared {
    pub fn new(original: &str) -> Prepared {
        // The common case (ASCII digits, no marks) needs no copy of the offsets.
        if original.chars().all(|c| prepared_char(c) == Some(c)) {
            return Prepared {
                text: original.to_string(),
                map: None,
            };
        }
        let mut text = String::with_capacity(original.len());
        let mut map = Vec::with_capacity(original.len() + 1);
        for (at, c) in original.char_indices() {
            if let Some(p) = prepared_char(c) {
                for _ in 0..p.len_utf8() {
                    map.push(at);
                }
                text.push(p);
            }
        }
        map.push(original.len());
        Prepared {
            text,
            map: Some(map),
        }
    }

    /// The byte of the original text for a byte of the prepared one.
    pub fn original(&self, at: usize) -> usize {
        match &self.map {
            None => at,
            Some(map) => map[at.min(map.len() - 1)],
        }
    }

    /// The end (exclusive) in the original of a range ending at `end` in the
    /// prepared text: just after the original character of the range's last
    /// byte, so ignorable marks after a match are not taken into it.
    pub fn original_end(&self, original: &str, end: usize) -> usize {
        match &self.map {
            None => end,
            Some(_) if end == 0 => self.original(0),
            Some(map) => {
                let at = map[(end - 1).min(map.len() - 1)];
                at + original[at..].chars().next().map_or(0, char::len_utf8)
            }
        }
    }
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
                spaced: true,
                chapter_units: &[],
                verse_units: &[],
            },
            ambiguous: Vec::new(),
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

/// Lower case, no full stops, single spaces; composed (NFC), without the
/// ignorable marks ([`is_ignorable`]), with accepted digits as ASCII, Greek
/// final sigma as σ, and the danda and Ethiopic full stop read as full stops.
pub fn normalise(alias: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let composed: String = alias.nfc().filter_map(prepared_char).collect();
    composed
        .to_lowercase()
        .replace('ς', "σ")
        .replace(['.', '।', '॥', '።', '፡', '־', '·'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Without the accents of Latin, Greek and Cyrillic letters (combining marks
/// U+0300–U+036F after decomposition). Other scripts' marks (Indic vowel
/// signs) are part of the letter and kept.
pub fn fold_marks(text: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    text.nfd()
        .filter(|c| !('\u{0300}'..='\u{036F}').contains(c))
        .nfc()
        .collect()
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

/// A reference one parser found, before the packs are weighed against each
/// other (`scripture::recognise`).
#[derive(Debug, Clone)]
pub struct RawMatch {
    /// Byte range in the text.
    pub start: usize,
    pub end: usize,
    pub reference: ScriptureRef,
    /// The book name as written ("Jn", "Johannes", "요").
    pub book: String,
    /// A verse was written (not only implied, as in "Jude 3").
    pub written_verse: bool,
    /// Korean: a chapter unit (장, 편) was written.
    pub chapter_unit: bool,
    pub language: ReferenceLanguage,
}

impl RawMatch {
    /// As a detected reference (UTF-16 offsets).
    pub fn detected(&self, text: &str) -> DetectedReference {
        DetectedReference {
            text: text[self.start..self.end].to_string(),
            start: utf16_offset(text, self.start),
            end: utf16_offset(text, self.end),
            reference: self.reference.to_dto(),
        }
    }
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
    /// The running-text pattern, compiled on first use: a generated pack's is
    /// only needed for a source written in its language.
    pattern: OnceLock<Regex>,
    /// Typed input of a generated pack: any book text, then this pack's notation.
    tail: OnceLock<Regex>,
    lookup: HashMap<String, Target>,
    /// Spellings that name more than one book in this language.
    ambiguous: HashMap<String, Vec<&'static Book>>,
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

/// How one language reads a whole typed input (see [`ReferenceParser::read`]).
#[derive(Debug)]
pub enum Reading {
    /// A passage of the canon.
    Found(ScriptureRef),
    /// The book is known here, but the passage is not in it (chapter 51 of
    /// John) or the notation does not hold: the error says which.
    Invalid(AppError),
    /// The book name means several books in this language.
    Ambiguous(Vec<&'static Book>),
    /// Not a reference in this language.
    Unknown,
}

impl ReferenceParser {
    /// Builds the parser of one dictionary.
    pub fn new(dictionary: AliasDictionary) -> Self {
        let AliasDictionary {
            language,
            entries,
            syntax,
            ambiguous: listed,
        } = dictionary;

        // A spelling that names two books is never read as either.
        let mut by_key: HashMap<String, Vec<Target>> = HashMap::new();
        for entry in &entries {
            by_key
                .entry(key_of(&syntax, &entry.alias))
                .or_default()
                .push(Target {
                    book: entry.book,
                    strictness: entry.strictness,
                });
        }
        let mut lookup: HashMap<String, Target> = HashMap::new();
        let mut ambiguous: HashMap<String, Vec<&'static Book>> = HashMap::new();
        for (key, targets) in by_key {
            let mut books: Vec<&'static Book> = Vec::new();
            for t in &targets {
                if !books.iter().any(|b| b.code == t.book.code) {
                    books.push(t.book);
                }
            }
            if books.len() == 1 {
                lookup.insert(key, targets[0]);
            } else {
                ambiguous.insert(key, books);
            }
        }
        for (alias, books) in listed {
            let key = key_of(&syntax, &alias);
            if !lookup.contains_key(&key) {
                ambiguous.insert(key, books);
            }
        }
        // Accent-free spellings ("Coríntios" → "Corintios", "Ё" → "Е") are
        // accepted only where they cannot be another book's own spelling and do
        // not point at two books themselves.
        let cased_data = syntax.grammar == Grammar::Data && syntax.require_capital;
        if syntax.grammar == Grammar::Latin || cased_data {
            let mut folded: HashMap<String, Vec<Target>> = HashMap::new();
            for entry in entries
                .iter()
                .filter(|e| !syntax.no_fold.contains(&e.alias.as_str()))
            {
                let key = fold(&key_of(&syntax, &entry.alias));
                let key = if cased_data { fold_marks(&key) } else { key };
                folded.entry(key).or_default().push(Target {
                    book: entry.book,
                    strictness: entry.strictness,
                });
            }
            for (key, targets) in folded {
                let first = targets[0];
                if targets.iter().all(|t| t.book.code == first.book.code)
                    && !lookup.contains_key(&key)
                    && !ambiguous.contains_key(&key)
                {
                    lookup.insert(key, first);
                }
            }
        }

        Self {
            language,
            syntax,
            pattern: OnceLock::new(),
            tail: OnceLock::new(),
            lookup,
            ambiguous,
        }
    }

    fn pattern(&self) -> &Regex {
        self.pattern.get_or_init(|| {
            // Longest aliases first, so "1 john" wins over "john".
            let mut keys: Vec<&String> = self.lookup.keys().collect();
            keys.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
            let alternatives = keys
                .iter()
                .map(|key| alias_pattern(&self.syntax, key))
                .collect::<Vec<_>>()
                .join("|");
            let pattern = match self.syntax.grammar {
                Grammar::Latin => latin_pattern(&alternatives, self.syntax.verse_separator),
                Grammar::Korean => korean_pattern(&alternatives),
                Grammar::Data => data_pattern(&self.syntax, &alternatives, true),
            };
            regex::RegexBuilder::new(&pattern)
                .size_limit(64 << 20)
                .build()
                .expect("reference pattern is valid")
        })
    }

    fn tail(&self) -> &Regex {
        self.tail.get_or_init(|| {
            let pattern = format!("^{}$", data_pattern(&self.syntax, ".+?", false));
            Regex::new(&pattern).expect("reference tail pattern is valid")
        })
    }

    /// The parser of one language, built once from its pack and shared.
    pub fn for_language(language: ReferenceLanguage) -> &'static ReferenceParser {
        static PARSERS: OnceLock<Vec<OnceLock<ReferenceParser>>> = OnceLock::new();
        let parsers = PARSERS.get_or_init(|| {
            (0..crate::scripture::packs::all().len())
                .map(|_| OnceLock::new())
                .collect()
        });
        let index = crate::scripture::packs::index_of(language);
        parsers[index].get_or_init(|| {
            ReferenceParser::new(crate::scripture::packs::pack(language).dictionary())
        })
    }

    /// Every key of this parser's lookup (dictionary keys and the accent-free
    /// spellings accepted), with its book: for comparing packs.
    pub fn lookup_entries(&self) -> impl Iterator<Item = (&str, &'static Book)> {
        self.lookup.iter().map(|(k, t)| (k.as_str(), t.book))
    }

    /// The references this parser finds in `text`, with byte ranges and the book
    /// name as written (see [`RawMatch`]). The same candidates as [`Self::detect`].
    /// Native digits (`٣:١٦`, `३:१६`) and full-width punctuation are read as
    /// ASCII; the ranges are those of `text` itself.
    pub fn matches(&self, text: &str) -> Vec<RawMatch> {
        let prepared = Prepared::new(text);
        let read = prepared.text.as_str();
        self.pattern()
            .captures_iter(read)
            .filter(|caps| self.accepts(read, caps))
            .filter_map(|caps| {
                let whole = caps.get(0)?;
                let reference = self.interpret(&caps).ok()?;
                let book = caps.name("book")?.as_str().to_string();
                // A match never ends in white space (the Korean pattern may take a trailing space).
                let end = whole.start() + whole.as_str().trim_end().len();
                let parts = self.parts(&caps);
                Some(RawMatch {
                    start: prepared.original(whole.start()),
                    end: prepared.original_end(text, end),
                    reference,
                    book,
                    written_verse: parts.v1.is_some()
                        || caps.name("unit").is_some_and(|m| m.as_str() == "절"),
                    chapter_unit: self.syntax.grammar != Grammar::Latin && parts.chapter_unit,
                    language: self.language,
                })
            })
            .collect()
    }

    /// The shared English parser (the default for a source with no recognised
    /// language). Typed input in any language goes through
    /// `scripture::resolve` instead.
    pub fn english() -> &'static ReferenceParser {
        Self::for_language(ReferenceLanguage::En)
    }

    pub fn language(&self) -> ReferenceLanguage {
        self.language
    }

    /// Parses input that is exactly one reference in this language. A bare
    /// book name opens its first chapter. Typed input of unknown language is
    /// read by `scripture::resolve`, with every pack.
    pub fn parse(&self, input: &str) -> AppResult<ScriptureRef> {
        match self.read(input) {
            Reading::Found(reference) => Ok(reference),
            Reading::Invalid(error) => Err(error),
            Reading::Ambiguous(books) => Err(ambiguous_error(input.trim(), &books, None)),
            Reading::Unknown if typed_text(input).is_empty() => Err(empty_error()),
            Reading::Unknown => Err(not_recognised_error(input.trim())),
        }
    }

    /// How this language reads a whole typed input.
    pub fn read(&self, input: &str) -> Reading {
        let typed = typed_text(input);
        let text = typed.as_str();
        if text.is_empty() {
            return Reading::Unknown;
        }
        let whole_key = key_of(&self.syntax, text);
        if let Some(target) = self.lookup_key(&whole_key) {
            return match ScriptureRef::chapter(target.book, 1) {
                Ok(reference) => Reading::Found(reference),
                Err(error) => Reading::Invalid(error),
            };
        }
        if let Some(books) = self.ambiguous.get(&whole_key) {
            return Reading::Ambiguous(books.clone());
        }
        let caps = match self.syntax.grammar {
            // A generated pack reads the book by lookup: one small pattern for
            // the notation, never the pack's whole alias list.
            Grammar::Data => match self.tail().captures(text) {
                Some(caps) => caps,
                None => return Reading::Unknown,
            },
            Grammar::Latin | Grammar::Korean => match self.pattern().captures(text) {
                Some(caps)
                    if caps
                        .get(0)
                        .is_some_and(|m| m.start() == 0 && m.end() == text.len()) =>
                {
                    caps
                }
                _ => return Reading::Unknown,
            },
        };
        let book_text = caps.name("book").map_or("", |m| m.as_str());
        let key = key_of(&self.syntax, book_text);
        if self.lookup_key(&key).is_none() {
            return match self.ambiguous.get(&key) {
                Some(books) => Reading::Ambiguous(books.clone()),
                None => Reading::Unknown,
            };
        }
        match self.interpret(&caps) {
            Ok(reference) => Reading::Found(reference),
            Err(error) => Reading::Invalid(error),
        }
    }

    /// Finds valid references in running text, under this language's
    /// false-positive policy (see the module notes). This language only: a
    /// source's references are read with every pack by `scripture::recognise`.
    pub fn detect(&self, text: &str) -> Vec<DetectedReference> {
        self.matches(text)
            .iter()
            .map(|m| m.detected(text))
            .collect()
    }

    /// A key, or its accent-free form where this language accepts one.
    fn lookup_key(&self, key: &str) -> Option<Target> {
        if let Some(target) = self.lookup.get(key) {
            return Some(*target);
        }
        if self.syntax.grammar == Grammar::Data && self.syntax.require_capital {
            return self.lookup.get(&fold_marks(&fold(key))).copied();
        }
        None
    }

    fn target(&self, caps: &Captures) -> Option<Target> {
        let book = caps.name("book")?.as_str();
        self.lookup_key(&key_of(&self.syntax, book))
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
            Grammar::Data => {
                let before = text[..whole.start()].chars().next_back();
                let after = text[whole.end()..].chars().next();
                // Never inside a number; where words are spaced, never inside a word.
                if after.is_some_and(|c| c.is_ascii_digit() || c == '_')
                    || before.is_some_and(|c| c.is_ascii_digit())
                {
                    return false;
                }
                if self.syntax.spaced
                    && (before.is_some_and(|c| c.is_alphanumeric() || c == '_')
                        || after.is_some_and(char::is_alphanumeric))
                {
                    return false;
                }
                // "3,16" or "3.5" goes on: a decimal or a notation not read in
                // running text — never a shorter reference cut out of it.
                let mut rest = text[whole.end()..].chars();
                if matches!(rest.next(), Some('.' | ','))
                    && rest.next().is_some_and(|c| c.is_ascii_digit())
                {
                    return false;
                }
                let capital = !self.syntax.require_capital
                    || book
                        .as_str()
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_uppercase() || c.is_ascii_digit());
                let parts = data_parts(caps);
                capital
                    && match target.strictness {
                        Strictness::Full => true,
                        Strictness::Unit => parts.v1.is_some() || parts.chapter_unit,
                        Strictness::Verse => parts.v1.is_some(),
                    }
            }
        }
    }

    fn parts(&self, caps: &Captures) -> Parts {
        match self.syntax.grammar {
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
            Grammar::Data => data_parts(caps),
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
        let Parts {
            c1,
            v1,
            n2,
            v2,
            chapter_unit,
            ..
        } = self.parts(caps);
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

/// Typed input as references are read: composed, native digits and
/// full-width punctuation as ASCII, without the brackets a title may be
/// quoted in (《约翰福音》3:16) and without a trailing full stop or comma.
fn typed_text(input: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let composed: String = input.nfc().collect();
    let prepared = Prepared::new(&composed).text;
    prepared
        .replace(['《', '》', '〈', '〉', '「', '」', '『', '』'], " ")
        .trim()
        .trim_end_matches(['.', ',', ';', '。', '،', '؛'])
        .trim()
        .to_string()
}

pub(crate) fn empty_error() -> AppError {
    AppError::InvalidReference(UserMessage::new(
        "reference.empty",
        "Type a passage, for example “John 15” or “Rom 8:1-17”.",
    ))
}

pub(crate) fn not_recognised_error(text: &str) -> AppError {
    AppError::InvalidReference(
        UserMessage::new(
            "reference.notRecognised",
            format!(
                "“{text}” is not a passage I recognise. Try a form like “John 15” or “Rom 8:1-17”."
            ),
        )
        .with("text", text),
    )
}

/// The input names several books (or passages): the options, never a guess.
/// `passages` are the passages when they are known, otherwise the books are
/// the options. The interface shows them in its own language (`books`,
/// `canonicals`); `options` is the English wording.
pub(crate) fn ambiguous_error(
    text: &str,
    books: &[&'static Book],
    passages: Option<&[ScriptureRef]>,
) -> AppError {
    let options: Vec<String> = match passages {
        Some(list) => list.iter().map(ScriptureRef::display).collect(),
        None => books.iter().map(|b| b.name.to_string()).collect(),
    };
    let codes: Vec<&str> = books.iter().map(|b| b.code).collect();
    let mut message = UserMessage::new(
        "reference.ambiguous",
        format!(
            "“{text}” could mean {}. Type more of the book’s name to choose.",
            options.join(" or ")
        ),
    )
    .with("text", text)
    .with("options", options.join(" / "))
    .with("books", codes.join(","));
    if let Some(list) = passages {
        let canonicals: Vec<String> = list.iter().map(ScriptureRef::canonical).collect();
        message = message.with("canonicals", canonicals.join(";"));
    }
    AppError::InvalidReference(message)
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
        r"(?i)(?P<book>{alternatives})\.?\s*(?P<c1>[0-9]{{1,3}})(?:(?:{separator})(?P<v1>[0-9]{{1,3}}))?(?:\s*[-‐‑‒–—]\s*(?P<n2>[0-9]{{1,3}})(?:(?:{separator})(?P<v2>[0-9]{{1,3}}))?)?(?-u:\b)"
    )
}

/// Korean: `3:16`, `3:16-18`, `3장 16절`, `3장 16-18절`, `3장 16절-4장 2절`,
/// `3-4장`, `3장`, `23편`, `3`, and `절` alone for one-chapter books.
fn korean_pattern(alternatives: &str) -> String {
    const DASH: &str = r"[-~‐‑‒–—]";
    format!(
        r"(?P<book>{alternatives})\s*(?P<c1>[0-9]{{1,3}})(?:\s*:\s*(?P<v1>[0-9]{{1,3}})(?:\s*{DASH}\s*(?P<n2>[0-9]{{1,3}})(?:\s*:\s*(?P<v2>[0-9]{{1,3}}))?)?\s*(?:절)?|\s*장\s*(?P<v1k>[0-9]{{1,3}})\s*절(?:\s*{DASH}\s*(?P<n2k>[0-9]{{1,3}})(?:\s*(?:장\s*(?P<v2k>[0-9]{{1,3}}))?\s*절))?|\s*장\s*(?P<v1c>[0-9]{{1,3}})\s*{DASH}\s*(?P<n2c>[0-9]{{1,3}})\s*절|\s*{DASH}\s*(?P<n2d>[0-9]{{1,3}})\s*(?P<unitd>[장편절])?|\s*(?P<unit>[장편절]))?"
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

/// A generated pack's notation: `3:16`, `3,16`, `3.16` (`,` and `.` only
/// between digits), ranges `3:16-18`, `3:16-4:2`, `3-4`, and where the
/// language counts with units, `3章16节`, `3章16-18节`, `第3章`, `บทที่ 3`.
///
/// In running text (`running`) only `:` and the units separate chapter and
/// verse: `,` and `.` between digits are decimals and thousands in the prose
/// of most of these languages (`3.5万人`, `Op 12.30 uur`, `2,5 km`), and the
/// generated packs are not reviewed against that prose.
fn data_pattern(syntax: &Syntax, alternatives: &str, running: bool) -> String {
    const DASH: &str = r"[-~‐‑‒–—]";
    const N: &str = r"[0-9]{1,3}";
    let alt = |units: &[&str]| {
        units
            .iter()
            .map(|u| regex::escape(u))
            .collect::<Vec<_>>()
            .join("|")
    };
    let cu = alt(syntax.chapter_units);
    let vu = alt(syntax.verse_units);
    let sep = if running {
        r"\s*:\s*"
    } else {
        syntax.verse_separator
    };
    let case = if syntax.require_capital { "(?i)" } else { "" };
    let verse_unit = if vu.is_empty() {
        String::new()
    } else {
        format!(r"(?:\s*(?:{vu}))?")
    };
    // A chapter unit may also stand before the number (Thai บทที่ 3, Chinese 第3章).
    let before = if cu.is_empty() {
        String::new()
    } else {
        format!(r"(?:(?P<cup>{cu}|第)\s*)?")
    };
    let mut branches = vec![format!(
        r"(?:{sep})(?P<v1>{N})(?:\s*{DASH}\s*(?P<n2>{N})(?:(?:{sep})(?P<v2>{N}))?)?{verse_unit}"
    )];
    if !cu.is_empty() {
        branches.push(format!(
            r"\s*(?P<cu>{cu})\s*(?P<v1u>{N}){verse_unit}(?:\s*{DASH}\s*(?P<n2u>{N})(?:\s*(?:{cu})\s*(?P<v2u>{N}))?{verse_unit})?"
        ));
        branches.push(format!(
            r"\s*(?P<cu2>{cu})(?:\s*{DASH}\s*(?P<n2c>{N})(?:\s*(?:{cu}))?)?"
        ));
    }
    branches.push(format!(
        r"\s*{DASH}\s*(?P<n2d>{N})(?:(?:{sep})(?P<v2d>{N}))?"
    ));
    format!(
        r"{case}(?P<book>{alternatives})\.?\s*{before}(?P<c1>{N})(?:{})?",
        branches.join("|")
    )
}

fn data_parts(caps: &Captures) -> Parts {
    let number = |names: &[&str]| {
        names
            .iter()
            .find_map(|n| caps.name(n))
            .and_then(|m| m.as_str().parse::<u16>().ok())
    };
    Parts {
        c1: number(&["c1"]).unwrap_or(0),
        v1: number(&["v1", "v1u"]),
        n2: number(&["n2", "n2u", "n2c", "n2d"]),
        v2: number(&["v2", "v2u", "v2d"]),
        chapter_unit: ["cu", "cu2", "cup"].iter().any(|n| caps.name(n).is_some()),
        verse_unit: false,
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
