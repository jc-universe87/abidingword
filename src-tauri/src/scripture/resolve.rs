//! One reader for typed Bible references in any of the 100 languages
//! (v0.18.2).
//!
//! Scripture navigation, Bible Study passage fields, Teaching, Presenter View
//! (*Bible passage*) and the assistant all read what a person types with
//! [`resolve`], through the one `scripture_reference_parse` command. The
//! person's interface language is a **preference, never a gate**: `Johannes
//! 15,5`, `Joh 15,5`, `John 15:5`, `Jean 15,5`, `Juan 15:5`, `João 15:5`,
//! `요한복음 15장 5절`, `約翰福音 15:5` and `Иоанна 15:5` all come out as
//! `JHN.15.5` whatever language the interface is in.
//!
//! The policy, for one typed input:
//!
//! 1. Every pack whose script occurs in the input reads it as a whole
//!    (`ReferenceParser::read`; a generated pack by lookup, so 100 languages
//!    cost about as much as one).
//! 2. The passages found are grouped by canonical reference. One passage →
//!    that passage, however many languages agree on it (but see 3).
//! 3. A passage read **only by generated packs** is refused when the
//!    person's own language or a reviewed pack knows the book and says the
//!    passage is not in it (`Jud 3:5`: Jude has one chapter — not Romanian
//!    Judges), and when the book is a reserved stem: the bare name of a
//!    numbered book in a reviewed language or a deuterocanonical abbreviation
//!    (`Sam`, `Sir`, `Mak`), which the person means otherwise.
//! 4. Several passages (`Jn 3:5`: John in English, French and Spanish, Jonah
//!    in Portuguese):
//!    * the preferred language decides if it read the input;
//!    * otherwise English, if it read the input (the long-standing reading of
//!      typed passages before v0.18.2);
//!    * otherwise, if exactly one of the passages was read by a reviewed pack
//!      (English, German, Korean, French, Spanish, Portuguese — the
//!      hand-checked dictionaries), that one;
//!    * otherwise nothing is guessed: the error lists the passages
//!      (`reference.ambiguous`).
//! 5. Nothing found: a name that means two books in its own language asks
//!    which (`reference.ambiguous`); a known book with a passage it does not
//!    have says so (the preferred language's error first, then a reviewed
//!    pack's); anything else is `reference.notRecognised`.
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

/// Reads a typed reference in any language. `preferred` is the person's
/// language (the interface language): it settles a genuine tie, nothing else.
pub fn resolve(input: &str, preferred: Option<ReferenceLanguage>) -> AppResult<ScriptureRef> {
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
            (
                pack.language,
                ReferenceParser::for_language(pack.language).read(text),
            )
        })
        .collect();
    // The person's language or a reviewed pack knows the book but not the passage.
    let known_but_invalid = readings.iter().position(|(l, r)| {
        matches!(r, Reading::Invalid(_)) && (Some(*l) == preferred || packs::pack(*l).is_reviewed())
    });

    // Rule 2: the passages found, each with the languages that read it.
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
    // Rule 3: an answer only generated packs give, where it would surprise.
    let generated_only = !groups.is_empty()
        && groups
            .iter()
            .all(|(_, languages)| languages.iter().all(|l| !packs::pack(*l).is_reviewed()));
    if generated_only {
        if let Some(index) = known_but_invalid {
            if let Reading::Invalid(error) =
                readings.into_iter().nth(index).map(|(_, r)| r).unwrap()
            {
                return Err(error);
            }
            unreachable!("the position found an Invalid reading");
        }
        if book_stem(text).is_some_and(|stem| reserved_stems().contains(&stem)) {
            return Err(not_recognised_error(text));
        }
    }
    if groups.len() == 1 {
        return Ok(groups.remove(0).0);
    }
    if groups.len() > 1 {
        // Rule 4.
        for decider in [preferred, Some(ReferenceLanguage::En)]
            .into_iter()
            .flatten()
        {
            if let Some((reference, _)) = groups.iter().find(|(_, l)| l.contains(&decider)) {
                return Ok(*reference);
            }
        }
        let reviewed: Vec<&(ScriptureRef, Vec<ReferenceLanguage>)> = groups
            .iter()
            .filter(|(_, languages)| languages.iter().any(|l| packs::pack(*l).is_reviewed()))
            .collect();
        if reviewed.len() == 1 {
            return Ok(reviewed[0].0);
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

    // Rule 5: nothing found. The preferred language speaks first, then the
    // reviewed packs, then the rest.
    let rank = |l: &ReferenceLanguage| {
        if Some(*l) == preferred {
            0
        } else if packs::pack(*l).is_reviewed() {
            1
        } else {
            2
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

/// The reference language an interface language code names ("de", "ko-KR").
pub fn preferred(code: Option<&str>) -> Option<ReferenceLanguage> {
    code.and_then(ReferenceLanguage::from_label)
}
