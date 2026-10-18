//! Recognising explicit Scripture references in any supported language
//! (v0.13.2).
//!
//! A source's language is a **priority signal, not a gate**: every language
//! pack (`scripture::packs`) reads the text, and its candidates are weighed
//! against each other by one deterministic policy. A German sermon finds
//! `John 15:4`, `Jean 15,4`, `Juan 15:4`, `João 15:4` and `요한복음 15장 4절`
//! as well as `Joh 15,4`; each comes out as the same canonical reference.
//!
//! The policy, for one text:
//!
//! 1. **The source language reads as before.** Its pack's matches are taken
//!    under its own false-positive policy (capitals, "Mal" needs a verse, …).
//! 2. **Another language's match must be strong:**
//!    * it names a verse (`Jean 15,4`; a chapter alone is too weak), except a
//!      Korean full book name with its chapter unit (`요한복음 15장`), which
//!      cannot be anything else;
//!    * its book name is not an ordinary word of the source language
//!      (`LanguagePack::ordinary_words`: German "am", "es", "mal"…);
//!    * its book name means **one** book across all packs for this reference.
//!      "Jn" is John in English, French and Spanish but Jonah in Portuguese:
//!      `Jn 15:5` can only be John (Jonah has four chapters), `Jn 3:5` could be
//!      either, so it is left alone unless the source language decides it.
//! 3. **Overlaps:** the longest match wins (`Joh 15,4` over the English
//!    reading `Joh 15`). Matches of the same text that name different passages
//!    are settled by the source language if it is among them, and otherwise
//!    dropped. No result depends on the order the packs are read in.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::scripture::canon::Book;
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::packs::{self, PACKS};
use crate::scripture::parser::{
    normalise, DetectedReference, OuterContext, ParagraphReferences, RawMatch, ReferenceParser,
};
use crate::scripture::reference::ScriptureRef;

/// Reads a source's explicit references with every pack, its own language first.
pub struct Recogniser {
    primary: ReferenceLanguage,
}

/// Book names across all packs, spelled alike once case, full stops, spaces
/// and ordinal marks are set aside: the books each can mean.
fn shared_names() -> &'static HashMap<String, Vec<&'static Book>> {
    static TABLE: OnceLock<HashMap<String, Vec<&'static Book>>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table: HashMap<String, Vec<&'static Book>> = HashMap::new();
        for pack in &PACKS {
            for (key, book) in ReferenceParser::for_language(pack.language).lookup_entries() {
                let books = table.entry(name_key(key)).or_default();
                if !books.iter().any(|b| b.code == book.code) {
                    books.push(book);
                }
            }
        }
        table
    })
}

/// A book name as compared across packs: case, full stops and ordinal marks
/// set aside, a number joined to its name or not, accents and word breaks kept. Accents can tell two books apart (Portuguese
/// "Jo" is John, "Jó" is Job); the accent-free spellings a pack does accept are
/// already among its own lookup keys.
fn name_key(name: &str) -> String {
    let spaced = normalise(&name.replace(['º', '°'], " "));
    // "1kor" and "1 kor" are one spelling; "i sa" (1 Samuel) and "isa" (Isaiah) are not.
    let digits = spaced.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && spaced.len() > digits && !spaced[digits..].starts_with(' ') {
        format!("{} {}", &spaced[..digits], &spaced[digits..])
    } else {
        spaced
    }
}

impl Recogniser {
    /// The recogniser for sources in this language (shared).
    pub fn for_source(primary: ReferenceLanguage) -> &'static Recogniser {
        static ALL: OnceLock<Vec<Recogniser>> = OnceLock::new();
        let all = ALL.get_or_init(|| {
            packs::all()
                .iter()
                .map(|p| Recogniser {
                    primary: p.language,
                })
                .collect()
        });
        &all[packs::index_of(primary)]
    }

    pub fn language(&self) -> ReferenceLanguage {
        self.primary
    }

    /// The source language's own parser (its notation and shorthand).
    pub fn primary(&self) -> &'static ReferenceParser {
        ReferenceParser::for_language(self.primary)
    }

    /// The explicit references in `text`, in order, as byte ranges.
    pub fn matches(&self, text: &str) -> Vec<RawMatch> {
        let mut candidates: Vec<RawMatch> = Vec::new();
        // The reviewed packs read every source; a generated pack reads only a
        // source written in its own language (its short abbreviations are not
        // reviewed against the prose of other languages).
        let own_generated = packs::pack(self.primary);
        let readers = PACKS
            .iter()
            .chain((!own_generated.is_reviewed()).then_some(own_generated));
        for pack in readers {
            if !pack.reads(text) {
                continue;
            }
            let own = pack.language == self.primary;
            let found = ReferenceParser::for_language(pack.language).matches(text);
            candidates.extend(found.into_iter().filter(|m| own || self.strong_enough(m)));
        }
        resolve(candidates, self.primary)
    }

    /// The explicit references in `text`, in order.
    pub fn detect(&self, text: &str) -> Vec<DetectedReference> {
        self.matches(text)
            .iter()
            .map(|m| m.detected(text))
            .collect()
    }

    /// The references of one paragraph: explicit ones in any language, and
    /// shorthand in the source language resolved from context
    /// (`scripture::parser::context`).
    pub fn detect_in_context(&self, text: &str, outer: &OuterContext) -> ParagraphReferences {
        self.primary()
            .detect_in_context_with(text, &self.matches(text), outer)
    }

    /// Rule 2: whether another language's match is strong enough to count here.
    fn strong_enough(&self, m: &RawMatch) -> bool {
        let korean_chapter = m.language == ReferenceLanguage::Ko && m.chapter_unit;
        if !m.written_verse && !korean_chapter {
            return false;
        }
        let name = name_key(&m.book);
        if packs::pack(self.primary)
            .ordinary_words
            .iter()
            .any(|w| name_key(w) == name)
        {
            return false;
        }
        // The books this spelling can mean in any pack, for this very reference.
        let possible: Vec<&&Book> = shared_names()
            .get(&name)
            .map(|books| books.iter().filter(|b| fits(b, &m.reference)).collect())
            .unwrap_or_default();
        possible.len() == 1 && possible[0].code == m.reference.book.code
    }
}

/// Whether a reference's chapters exist in a book.
fn fits(book: &Book, reference: &ScriptureRef) -> bool {
    reference.start.chapter <= book.chapter_count && reference.end.chapter <= book.chapter_count
}

/// Rule 3: overlapping candidates settled deterministically.
fn resolve(mut candidates: Vec<RawMatch>, primary: ReferenceLanguage) -> Vec<RawMatch> {
    // Longest first; then the source language; then position. Ties beyond that
    // are compared by what they say, never by which pack found them first.
    candidates.sort_by(|a, b| {
        (b.end - b.start)
            .cmp(&(a.end - a.start))
            .then((b.language == primary).cmp(&(a.language == primary)))
            .then(a.start.cmp(&b.start))
            .then(a.reference.canonical().cmp(&b.reference.canonical()))
    });
    let mut taken: Vec<RawMatch> = Vec::new();
    let mut refused: Vec<(usize, usize)> = Vec::new();
    for (index, candidate) in candidates.iter().enumerate() {
        let overlaps = |s: usize, e: usize| candidate.start < e && s < candidate.end;
        if taken.iter().any(|t| overlaps(t.start, t.end))
            || refused.iter().any(|(s, e)| overlaps(*s, *e))
        {
            continue;
        }
        // The same text read as different passages: the source language settles it, or nothing does.
        let same_span: Vec<&RawMatch> = candidates
            .iter()
            .filter(|c| c.start == candidate.start && c.end == candidate.end)
            .collect();
        let disagree = same_span
            .iter()
            .any(|c| c.reference.canonical() != candidate.reference.canonical());
        if disagree && candidate.language != primary {
            refused.push((candidate.start, candidate.end));
            continue;
        }
        let _ = index;
        taken.push(candidate.clone());
    }
    taken.sort_by_key(|m| (m.start, m.end));
    taken
}

/// Book names that mean different books in different packs (for the record
/// and the tests): `(name, book codes)`, sorted.
pub fn contested_names() -> Vec<(String, Vec<&'static str>)> {
    let mut out: Vec<(String, Vec<&'static str>)> = shared_names()
        .iter()
        .filter(|(_, books)| books.len() > 1)
        .map(|(name, books)| {
            let mut codes: Vec<&'static str> = books.iter().map(|b| b.code).collect();
            codes.sort_unstable();
            (name.clone(), codes)
        })
        .collect();
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidates(text: &str) -> Vec<RawMatch> {
        PACKS
            .iter()
            .flat_map(|p| ReferenceParser::for_language(p.language).matches(text))
            .collect()
    }

    #[test]
    fn the_outcome_never_depends_on_the_order_candidates_arrive_in() {
        for text in [
            "Jn 3:5 und Joh 15,4; Mal 4,3, Jean 15,7-8, Jo 15:5.",
            "Jn 15,5 und 요 15:5",
        ] {
            for primary in [
                ReferenceLanguage::En,
                ReferenceLanguage::De,
                ReferenceLanguage::Pt,
            ] {
                let all = candidates(text);
                let forward = resolve(all.clone(), primary);
                let mut reversed = all.clone();
                reversed.reverse();
                let mut rotated = all.clone();
                rotated.rotate_left(all.len() / 2);
                for other in [resolve(reversed, primary), resolve(rotated, primary)] {
                    let a: Vec<_> = forward
                        .iter()
                        .map(|m| (m.start, m.end, m.reference.canonical()))
                        .collect();
                    let b: Vec<_> = other
                        .iter()
                        .map(|m| (m.start, m.end, m.reference.canonical()))
                        .collect();
                    assert_eq!(a, b, "{text:?} {primary:?}");
                }
            }
        }
    }

    #[test]
    fn contested_names_are_known() {
        let contested = contested_names();
        eprintln!("CONTESTED {contested:?}");
        assert!(contested
            .iter()
            .any(|(n, codes)| n == "jn" && codes == &["JHN", "JON"]));
    }
}
