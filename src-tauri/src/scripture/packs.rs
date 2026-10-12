//! Bible-reference language packs (v0.13.2).
//!
//! Everything language-specific about reading a Scripture reference lives in
//! one [`LanguagePack`]: its book-name lexicon and explicit notation (the
//! [`AliasDictionary`], `scripture::aliases`), its shorthand grammar for
//! references written without a book, the separators that join references in
//! a list, its script, and the ordinary words of the language that must never
//! be read as another language's book abbreviation. Canonical Scripture
//! identity (`scripture::canon`: GEN … REV) and resolution (`ScriptureRef`) are
//! language independent and never change when a pack is added.
//!
//! How packs are used (`scripture::recognise`):
//!
//! * **Explicit references** (with a book name) are read with **every** pack;
//!   the source's language is a priority signal, not a gate.
//! * **Shorthand** (`15:4`, `v. 5`) is read with the source language's pack
//!   only, and only with context (`scripture::parser::context`).
//!
//! Adding a language (see `docs/reference-language-packs.md`): a
//! `ReferenceLanguage` variant and its labels, an alias file built from a
//! reliable published source (with what it omits and why), a `LanguagePack`
//! entry in [`PACKS`], and its tests (every book named, no alias pointing at
//! two books, notation, shorthand, collisions with the other packs).

use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::AliasDictionary;

/// The writing system a pack's book names use. A pack is only run over text
/// that contains its script, which keeps reading a page cheap as packs grow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Script {
    Latin,
    Hangul,
}

impl Script {
    /// Whether `text` contains a letter of this script.
    pub fn occurs_in(self, text: &str) -> bool {
        match self {
            Script::Latin => text.chars().any(|c| c.is_ascii_alphabetic() || ('\u{00C0}'..='\u{024F}').contains(&c)),
            Script::Hangul => text
                .chars()
                .any(|c| matches!(c, '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}' | '\u{AC00}'..='\u{D7AF}')),
        }
    }
}

/// How references are written without a book in a language.
#[derive(Debug, Clone, Copy)]
pub struct Shorthand {
    /// Regex alternatives that separate chapter and verse in a bookless
    /// reference (English uses `:` only: a bookless `3.16` is a decimal).
    pub bookless_separator: &'static str,
    /// Regex for the words of verse-only shorthand before the number (`v.`,
    /// `vv.`, `verse`); `None` where the verse unit follows the number (Korean
    /// `4절`, handled by the Korean grammar).
    pub verse_words: Option<&'static str>,
    /// Whether `,` joins references in a list (it does not where `,` is the
    /// chapter/verse separator). `;` always does.
    pub comma_joins_list: bool,
}

/// Everything one language contributes to reading references.
pub struct LanguagePack {
    pub language: ReferenceLanguage,
    pub script: Script,
    /// Book names and abbreviations, and the explicit notation.
    pub dictionary: fn() -> AliasDictionary,
    pub shorthand: Shorthand,
    /// Ordinary words of this language (lower case) that, in a source of this
    /// language, are never read as another language's book abbreviation:
    /// English "is", "am" (left out of the English dictionary for that reason);
    /// German "am" (an dem), "es" (it), "mal" (times), "na" (well), "rom" (the
    /// city: the German dictionary accepts only "Röm" for Romans); French "es",
    /// "est" (are, is); Spanish "es" (is). A pack's own aliases are governed by
    /// its own dictionary, not by this list. Only words certainly ordinary are
    /// listed: a word here hides a real reference of another language.
    ///
    /// These are **safety exceptions, not stop-word lists**: each entry closes a
    /// known collision between this language's prose and another pack's
    /// abbreviation. They grow only with a reviewed case and its test, never
    /// speculatively.
    pub ordinary_words: &'static [&'static str],
    /// Words that introduce a reference in running text ("See", "Vgl.",
    /// "Voir", "Véase"), lower case, without a trailing full stop. A line that
    /// begins with one is a pointer to a passage, never a heading
    /// (`scripture::parser::context`). Lines of any language are checked
    /// against every pack's list.
    pub reference_lead_ins: &'static [&'static str],
    /// The same, for languages that put the word after the reference (Korean
    /// "(요 3:16 참조)"): a line that ends with one is not a heading.
    pub reference_tails: &'static [&'static str],
}

/// The packs, one per language with a reviewed dictionary. Order carries no
/// meaning: no result depends on it.
pub static PACKS: [LanguagePack; 6] = [
    LanguagePack {
        language: ReferenceLanguage::En,
        script: Script::Latin,
        dictionary: AliasDictionary::english,
        shorthand: Shorthand {
            bookless_separator: ":",
            verse_words: Some(r"vv?\.|verses?"),
            comma_joins_list: true,
        },
        ordinary_words: &["is", "am"],
        reference_lead_ins: &["see also", "also see", "see", "compare", "cf", "cp"],
        reference_tails: &[],
    },
    LanguagePack {
        language: ReferenceLanguage::De,
        script: Script::Latin,
        dictionary: || crate::scripture::aliases::dictionary(ReferenceLanguage::De),
        shorthand: Shorthand {
            bookless_separator: ":|,",
            verse_words: Some(r"vv?\.|verse?"),
            comma_joins_list: false,
        },
        ordinary_words: &["am", "es", "mal", "na", "rom"],
        reference_lead_ins: &["siehe auch", "siehe", "vergleiche", "vgl", "s"],
        reference_tails: &[],
    },
    LanguagePack {
        language: ReferenceLanguage::Ko,
        script: Script::Hangul,
        dictionary: || crate::scripture::aliases::dictionary(ReferenceLanguage::Ko),
        shorthand: Shorthand {
            bookless_separator: ":",
            verse_words: None,
            comma_joins_list: true,
        },
        ordinary_words: &[],
        reference_lead_ins: &["참조", "참고", "비교"],
        reference_tails: &["참조", "참고"],
    },
    LanguagePack {
        language: ReferenceLanguage::Fr,
        script: Script::Latin,
        dictionary: || crate::scripture::aliases::dictionary(ReferenceLanguage::Fr),
        shorthand: Shorthand {
            bookless_separator: ":|,",
            verse_words: Some(r"vv?\.|versets?"),
            comma_joins_list: false,
        },
        ordinary_words: &["es", "est"],
        reference_lead_ins: &["voir aussi", "voir", "comparer", "cf"],
        reference_tails: &[],
    },
    LanguagePack {
        language: ReferenceLanguage::Es,
        script: Script::Latin,
        dictionary: || crate::scripture::aliases::dictionary(ReferenceLanguage::Es),
        shorthand: Shorthand {
            bookless_separator: ":|,",
            verse_words: Some(r"vv?\.|vers(?:í|i)culos?"),
            comma_joins_list: false,
        },
        ordinary_words: &["es"],
        reference_lead_ins: &["véase también", "véase", "vease", "ver", "comparar", "cf"],
        reference_tails: &[],
    },
    LanguagePack {
        language: ReferenceLanguage::Pt,
        script: Script::Latin,
        dictionary: || crate::scripture::aliases::dictionary(ReferenceLanguage::Pt),
        shorthand: Shorthand {
            bookless_separator: ":|,",
            verse_words: Some(r"vv?\.|vers(?:í|i)culos?"),
            comma_joins_list: false,
        },
        ordinary_words: &[],
        reference_lead_ins: &["ver também", "ver", "veja", "comparar", "cf"],
        reference_tails: &[],
    },
];

/// The pack of a language.
pub fn pack(language: ReferenceLanguage) -> &'static LanguagePack {
    PACKS
        .iter()
        .find(|p| p.language == language)
        .expect("every reference language has a pack")
}

/// The index of a language's pack in [`PACKS`] (for per-pack caches).
pub fn index_of(language: ReferenceLanguage) -> usize {
    PACKS
        .iter()
        .position(|p| p.language == language)
        .expect("every reference language has a pack")
}
