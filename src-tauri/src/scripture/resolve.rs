//! One reader for typed Bible references in any of the 100 languages
//! (v0.18.2).
//!
//! Scripture navigation, Bible Study passage fields, Teaching, the
//! presentation editor, Presenter View (*Bible passage*) and the assistant all
//! read what a person types with [`resolve`], through the one
//! `scripture_reference_parse` command. No language is a gate: `Johannes
//! 15,5`, `Joh 15,5`, `John 15:5`, `Jean 15,5`, `Juan 15:5`, `João 15:5`,
//! `요한복음 15장 5절`, `約翰福音 15:5` and `Иоанна 15:5` all come out as
//! `JHN.15.5` whatever the Bible and the interface are in.
//!
//! The context ([`Context`]) is two languages, each optional: the language
//! of the Bible translation the person is reading (its stored language tag,
//! never guessed from its name) and the interface language. English has no
//! place of its own in the order.
//!
//! The policy, for one typed input:
//!
//! 1. Every pack whose script occurs in the input reads it as a whole
//!    (`ReferenceParser::read`; a generated pack by lookup, so 100 languages
//!    cost about as much as one). The passages found are grouped by
//!    canonical reference.
//! 2. **Safety:** a passage read **only by generated packs** is refused when
//!    a context language or a reviewed pack knows the book and says the
//!    passage is not in it (`Jud 3:5`: Jude has one chapter — not Romanian
//!    Judges), and when the book is a reserved stem: the bare name of a
//!    numbered book in a reviewed language or a deuterocanonical abbreviation
//!    (`Sam`, `Sir`, `Mak`). Where a reviewed pack read the input, passages
//!    only generated packs read are not credible beside it, unless one of
//!    them is a context language's reading and no passage has two or more
//!    reviewed languages behind it. These rules hold for the Bible's own
//!    language too (a Romanian Bible's `Jud 3:5` still says Jude has one
//!    chapter).
//! 3. **Several credible passages** (`Jn 3:5`: John in English, French and
//!    Spanish, Jonah in Portuguese), in this order:
//!    1. the **Bible's language** decides, if it read the input;
//!    2. the **interface language** decides, if it read the input;
//!    3. the **common reading**: one passage left, or one that a strict
//!       majority of the reviewed languages reading the input agree on
//!       (`Jn` is John in three of the four) — generated packs do not vote;
//!    4. otherwise nothing is guessed: the error lists the passages
//!       (`reference.ambiguous`).
//! 4. Nothing found: a name that means two books in its own language asks
//!    which (`reference.ambiguous`); a known book with a passage it does not
//!    have says so (the Bible's language first, then the interface's, then a
//!    reviewed pack's); anything else is `reference.notRecognised`.
//!
//! Verses are checked against the canon (`canon::verse_count`) before any of
//! this: a reading that names a verse the canon does not have (`Jn 3:16` read
//! as Jonah 3:16; Jonah 3 has 10 verses) is invalid and never competes with a
//! real passage, whatever language read it. A verse beyond the canon that the
//! Bible being read does have is accepted ([`resolve_with`]).
//!
//! Input longer than [`MAX_TYPED`] characters is not a reference.
//!
//! Running text (sources, notes) is read by `scripture::recognise`, which is
//! deliberately stricter; this module is for input that the person has said
//! is a reference.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;

use crate::error::AppResult;
use crate::scripture::canon::Book;
use crate::scripture::language::{fold, ReferenceLanguage};
use crate::scripture::packs;
use crate::scripture::packs::PACKS;
use crate::scripture::parser::{
    ambiguous_error, empty_error, normalise, not_recognised_error, Reading, ReferenceParser,
};

/// The longest typed input read as a reference (a passage is a few words).
pub const MAX_TYPED: usize = 200;

/// Deuterocanonical and other abbreviations a person in a reviewed language
/// means as a book outside the 66 (or as a numbered book), never as a
/// generated pack's reading (Kurdish "Şîr" folds to "sir").
const RESERVED: &[&str] = &[
    "sir",
    "sirach",
    "tob",
    "tobit",
    "tobias",
    "jdt",
    "judith",
    "bar",
    "baruch",
    "mak",
    "makk",
    "macc",
    "mac",
    "makkabäer",
    "maccabees",
    "weish",
    "wis",
    "sap",
    "sus",
    "so",
];

/// The bare names of numbered books in the reviewed packs ("sam" of "1 sam",
/// "kön" of "1 kön") that are not book names themselves, and [`RESERVED`].
fn reserved_stems() -> &'static HashSet<String> {
    static STEMS: OnceLock<HashSet<String>> = OnceLock::new();
    STEMS.get_or_init(|| {
        let mut stems: HashSet<String> = HashSet::new();
        let mut names: HashSet<String> = HashSet::new();
        for pack in &PACKS {
            for (key, _) in ReferenceParser::for_language(pack.language).lookup_entries() {
                names.insert(fold(key));
                if let Some((number, rest)) = key.split_once(' ') {
                    if matches!(number, "1" | "2" | "3" | "i" | "ii" | "iii") {
                        stems.insert(fold(rest));
                    }
                }
            }
        }
        // A stem that is itself a book name in a reviewed language (Spanish
        // "Juan" beside "1 Juan") is that book, not reserved.
        stems.retain(|stem| !names.contains(stem));
        stems.extend(RESERVED.iter().map(|s| fold(s)));
        stems
    })
}

/// The book name of a typed input, without a leading number ("1 Mak 3:5" → "mak").
fn book_stem(text: &str) -> Option<String> {
    static BOOK: OnceLock<Regex> = OnceLock::new();
    let pattern = BOOK.get_or_init(|| {
        Regex::new(r"^\s*(?:[0-9]+\.?\s*|(?i:i{1,3})\.?\s+)?([^0-9]+?)\.?\s*[0-9]").expect("valid")
    });
    let name = pattern.captures(text)?.get(1)?.as_str();
    Some(fold(&normalise(name)))
}
use crate::scripture::reference::ScriptureRef;

/// What the person is doing when they type a reference: the language of the
/// Bible they are reading and the interface language. Either may be absent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Context {
    /// From the translation's stored language tag (`bibles.language_code`).
    pub bible: Option<ReferenceLanguage>,
    pub interface: Option<ReferenceLanguage>,
}

impl Context {
    pub fn new(bible: Option<ReferenceLanguage>, interface: Option<ReferenceLanguage>) -> Self {
        Self { bible, interface }
    }

    /// The context languages, strongest first.
    fn deciders(&self) -> impl Iterator<Item = ReferenceLanguage> {
        [self.bible, self.interface].into_iter().flatten()
    }

    fn contains(&self, language: ReferenceLanguage) -> bool {
        self.bible == Some(language) || self.interface == Some(language)
    }
}

/// Reads a typed reference in any language, in the person's context, with
/// verses checked against the canon only.
pub fn resolve(input: &str, context: Context) -> AppResult<ScriptureRef> {
    resolve_with(input, context, &|_, _, _| false)
}

/// As [`resolve`]. `bible_has_verse` says whether an installed Bible has a
/// verse the canon does not (Louis Segond's Exodus 7:29): such a verse is
/// accepted, never refused. A verse missing from a Bible is never a reason
/// to refuse a reference the canon has.
pub fn resolve_with(
    input: &str,
    context: Context,
    bible_has_verse: &dyn Fn(&'static Book, u16, u16) -> bool,
) -> AppResult<ScriptureRef> {
    let text = input.trim();
    if text
        .trim_matches(|c: char| c.is_whitespace() || ".,;".contains(c))
        .is_empty()
    {
        return Err(empty_error());
    }
    if text.chars().count() > MAX_TYPED {
        let shown: String = text.chars().take(40).collect();
        return Err(not_recognised_error(&format!("{shown}…")));
    }
    let readings: Vec<(ReferenceLanguage, Reading)> = packs::all()
        .iter()
        .filter(|pack| pack.reads(text))
        .map(|pack| {
            let reading = match ReferenceParser::for_language(pack.language).read(text) {
                // A verse the canon does not have is not a passage: it never
                // competes with a real one ("Jn 3:16" is not Jonah 3:16).
                Reading::Found(reference) => match reference.canon_verse_error(bible_has_verse) {
                    Some(error) => Reading::Invalid(error),
                    None => Reading::Found(reference),
                },
                other => other,
            };
            (pack.language, reading)
        })
        .collect();
    let reviewed = |l: &ReferenceLanguage| packs::pack(*l).is_reviewed();
    // A context language or a reviewed pack knows the book but not the passage.
    let known_but_invalid = readings.iter().position(|(l, r)| {
        matches!(r, Reading::Invalid(_)) && (context.contains(*l) || reviewed(l))
    });

    // The passages found, each with the languages that read it.
    let mut groups: Vec<(ScriptureRef, Vec<ReferenceLanguage>)> = Vec::new();
    for (language, reading) in &readings {
        if let Reading::Found(reference) = reading {
            match groups
                .iter_mut()
                .find(|(r, _)| r.canonical() == reference.canonical())
            {
                Some((_, languages)) => languages.push(*language),
                None => groups.push((*reference, vec![*language])),
            }
        }
    }
    // Rule 2: safety.
    let any_reviewed = groups.iter().any(|(_, l)| l.iter().any(reviewed));
    if !groups.is_empty() && !any_reviewed {
        if let Some(index) = known_but_invalid {
            if let Some((_, Reading::Invalid(error))) = readings.into_iter().nth(index) {
                return Err(error);
            }
            unreachable!("the position found an Invalid reading");
        }
        if book_stem(text).is_some_and(|stem| reserved_stems().contains(&stem)) {
            return Err(not_recognised_error(text));
        }
    }
    if any_reviewed {
        // Beside a reviewed reading, one only generated packs give is not
        // credible — unless it is the reading of a context language and no
        // passage has two or more reviewed languages behind it (an Italian
        // Bible's "Es 3:5" is Exodus against English alone; its data's
        // "Gn 3:5" is not Jonah against four reviewed readings of Genesis).
        let strongest = groups
            .iter()
            .map(|(_, l)| l.iter().filter(|l| reviewed(l)).count())
            .max()
            .unwrap_or(0);
        groups.retain(|(_, l)| {
            l.iter().any(reviewed) || (strongest <= 1 && l.iter().any(|l| context.contains(*l)))
        });
    }
    if groups.len() == 1 {
        return Ok(groups.remove(0).0);
    }
    if groups.len() > 1 {
        // Rule 3: the Bible's language, then the interface language.
        for decider in context.deciders() {
            if let Some((reference, _)) = groups.iter().find(|(_, l)| l.contains(&decider)) {
                return Ok(*reference);
            }
        }
        // The common reading: a strict majority of the reviewed languages.
        let votes: Vec<usize> = groups
            .iter()
            .map(|(_, l)| l.iter().filter(|l| reviewed(l)).count())
            .collect();
        let total: usize = votes.iter().sum();
        if let Some(winner) = votes.iter().position(|v| 2 * v > total) {
            return Ok(groups[winner].0);
        }
        groups.sort_by_key(|(r, _)| (r.book.ordinal, r.start_key()));
        let mut books: Vec<&'static Book> = Vec::new();
        for (r, _) in &groups {
            if !books.iter().any(|b| b.code == r.book.code) {
                books.push(r.book);
            }
        }
        let passages: Vec<ScriptureRef> = groups.iter().map(|(r, _)| *r).collect();
        return Err(ambiguous_error(text, &books, Some(&passages)));
    }

    // Rule 4: nothing found. The Bible's language speaks first, then the
    // interface's, then the reviewed packs, then the rest.
    let rank = |l: &ReferenceLanguage| {
        if context.bible == Some(*l) {
            0
        } else if context.interface == Some(*l) {
            1
        } else if reviewed(l) {
            2
        } else {
            3
        }
    };
    let mut readings = readings;
    readings.sort_by_key(|(l, _)| rank(l));
    if let Some((_, Reading::Ambiguous(books))) = readings
        .iter()
        .find(|(_, r)| matches!(r, Reading::Ambiguous(_)))
    {
        let mut books = books.clone();
        books.sort_by_key(|b| b.ordinal);
        return Err(ambiguous_error(text, &books, None));
    }
    if let Some(Reading::Invalid(error)) = readings
        .into_iter()
        .map(|(_, r)| r)
        .find(|r| matches!(r, Reading::Invalid(_)))
    {
        return Err(error);
    }
    Err(not_recognised_error(text))
}

/// The reference language a stored language tag names ("pt", "pt-BR", "zh",
/// "deu"), for a Bible's `language_code`. A tag only: a name ("Português"),
/// an empty or missing tag, or an unknown language is no signal. Never
/// guessed from a translation's name, short name, file or publisher.
pub fn language_of_tag(tag: Option<&str>) -> Option<ReferenceLanguage> {
    let primary = tag?.trim().split(['-', '_']).next()?;
    if !(2..=3).contains(&primary.len()) || !primary.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let primary = primary.to_ascii_lowercase();
    // ISO 639-2/B codes and the macrolanguage members Bible files use.
    let primary = match primary.as_str() {
        "cmn" | "chi" => "zh",
        "dut" => "nl",
        "per" | "fas" | "pes" => "fa",
        "ara" | "arb" => "ar",
        "rum" => "ro",
        "cze" => "cs",
        "gre" => "el",
        "msa" | "may" | "zsm" => "ms",
        other => other,
    };
    ReferenceLanguage::from_label(primary)
}

/// The reference language an interface language code names ("de", "ko-KR").
pub fn preferred(code: Option<&str>) -> Option<ReferenceLanguage> {
    code.and_then(ReferenceLanguage::from_label)
}
