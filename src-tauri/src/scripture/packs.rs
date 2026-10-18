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

use std::sync::OnceLock;

use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::AliasDictionary;

/// The writing system a pack's book names use. A pack is only run over text
/// that contains one of its scripts, which keeps reading a page cheap as packs
/// grow (100 languages).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Script {
    Latin,
    Cyrillic,
    Greek,
    Hangul,
    Han,
    Hiragana,
    Katakana,
    Arabic,
    Hebrew,
    Devanagari,
    Bengali,
    Gurmukhi,
    Gujarati,
    Oriya,
    Tamil,
    Telugu,
    Kannada,
    Malayalam,
    Sinhala,
    Thai,
    Lao,
    Khmer,
    Myanmar,
    Ethiopic,
    Yi,
    OlChiki,
    SylotiNagri,
    Tibetan,
    Georgian,
    Armenian,
}

impl Script {
    /// The name used in `reference-packs.json` ("Latin", "Han", "OlChiki").
    pub fn from_name(name: &str) -> Option<Script> {
        Some(match name {
            "Latin" => Script::Latin,
            "Cyrillic" => Script::Cyrillic,
            "Greek" => Script::Greek,
            "Hangul" => Script::Hangul,
            "Han" => Script::Han,
            "Hiragana" => Script::Hiragana,
            "Katakana" => Script::Katakana,
            "Arabic" => Script::Arabic,
            "Hebrew" => Script::Hebrew,
            "Devanagari" => Script::Devanagari,
            "Bengali" => Script::Bengali,
            "Gurmukhi" => Script::Gurmukhi,
            "Gujarati" => Script::Gujarati,
            "Oriya" => Script::Oriya,
            "Tamil" => Script::Tamil,
            "Telugu" => Script::Telugu,
            "Kannada" => Script::Kannada,
            "Malayalam" => Script::Malayalam,
            "Sinhala" => Script::Sinhala,
            "Thai" => Script::Thai,
            "Lao" => Script::Lao,
            "Khmer" => Script::Khmer,
            "Myanmar" => Script::Myanmar,
            "Ethiopic" => Script::Ethiopic,
            "Yi" => Script::Yi,
            "OlChiki" => Script::OlChiki,
            "SylotiNagri" => Script::SylotiNagri,
            "Tibetan" => Script::Tibetan,
            "Georgian" => Script::Georgian,
            "Armenian" => Script::Armenian,
            _ => return None,
        })
    }

    /// The script of one character, when it is a letter of a script a pack uses.
    pub fn of(c: char) -> Option<Script> {
        Some(match c {
            'A'..='Z' | 'a'..='z' | '\u{00C0}'..='\u{024F}' | '\u{1E00}'..='\u{1EFF}' => {
                Script::Latin
            }
            '\u{0370}'..='\u{03FF}' | '\u{1F00}'..='\u{1FFF}' => Script::Greek,
            '\u{0400}'..='\u{052F}' => Script::Cyrillic,
            '\u{0530}'..='\u{058F}' => Script::Armenian,
            '\u{0590}'..='\u{05FF}' => Script::Hebrew,
            '\u{0600}'..='\u{06FF}'
            | '\u{0750}'..='\u{077F}'
            | '\u{08A0}'..='\u{08FF}'
            | '\u{FB50}'..='\u{FDFF}'
            | '\u{FE70}'..='\u{FEFF}' => Script::Arabic,
            '\u{0900}'..='\u{097F}' => Script::Devanagari,
            '\u{0980}'..='\u{09FF}' => Script::Bengali,
            '\u{0A00}'..='\u{0A7F}' => Script::Gurmukhi,
            '\u{0A80}'..='\u{0AFF}' => Script::Gujarati,
            '\u{0B00}'..='\u{0B7F}' => Script::Oriya,
            '\u{0B80}'..='\u{0BFF}' => Script::Tamil,
            '\u{0C00}'..='\u{0C7F}' => Script::Telugu,
            '\u{0C80}'..='\u{0CFF}' => Script::Kannada,
            '\u{0D00}'..='\u{0D7F}' => Script::Malayalam,
            '\u{0D80}'..='\u{0DFF}' => Script::Sinhala,
            '\u{0E00}'..='\u{0E7F}' => Script::Thai,
            '\u{0E80}'..='\u{0EFF}' => Script::Lao,
            '\u{0F00}'..='\u{0FFF}' => Script::Tibetan,
            '\u{1000}'..='\u{109F}' => Script::Myanmar,
            '\u{10A0}'..='\u{10FF}' => Script::Georgian,
            '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}' | '\u{AC00}'..='\u{D7AF}' => {
                Script::Hangul
            }
            '\u{1200}'..='\u{139F}' | '\u{2D80}'..='\u{2DDF}' => Script::Ethiopic,
            '\u{1780}'..='\u{17FF}' => Script::Khmer,
            '\u{1C50}'..='\u{1C7F}' => Script::OlChiki,
            '\u{A800}'..='\u{A82F}' => Script::SylotiNagri,
            '\u{3040}'..='\u{309F}' => Script::Hiragana,
            '\u{30A0}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}' => Script::Katakana,
            '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}' => {
                Script::Han
            }
            '\u{A000}'..='\u{A4CF}' => Script::Yi,
            _ => return None,
        })
    }

    /// Whether `text` contains a letter of this script.
    pub fn occurs_in(self, text: &str) -> bool {
        text.chars().any(|c| Script::of(c) == Some(self))
    }

    /// Scripts with capital letters (where a reference in running text must
    /// start with a capital, as the Latin packs ask).
    pub fn is_cased(self) -> bool {
        matches!(
            self,
            Script::Latin | Script::Cyrillic | Script::Greek | Script::Armenian
        )
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
    /// The scripts its book names are written in.
    pub scripts: &'static [Script],
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

/// The reviewed packs: one per language with a hand-reviewed dictionary
/// (`scripture::aliases`). They read running text across languages; the
/// generated packs ([`all`]) read typed references in any language and a
/// source written in their own language. Order carries no meaning: no result
/// depends on it.
pub static PACKS: [LanguagePack; 6] = [
    LanguagePack {
        language: ReferenceLanguage::En,
        scripts: &[Script::Latin],
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
        scripts: &[Script::Latin],
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
        scripts: &[Script::Hangul],
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
        scripts: &[Script::Latin],
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
        scripts: &[Script::Latin],
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
        scripts: &[Script::Latin],
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

impl LanguagePack {
    /// Book names and abbreviations, and the explicit notation.
    pub fn dictionary(&self) -> AliasDictionary {
        match self.language {
            ReferenceLanguage::Data(index) => crate::scripture::data_packs::dictionary(index),
            language => crate::scripture::aliases::dictionary(language),
        }
    }

    /// Whether `text` has a letter of one of its scripts.
    pub fn reads(&self, text: &str) -> bool {
        self.scripts.iter().any(|s| s.occurs_in(text))
    }

    pub fn is_reviewed(&self) -> bool {
        !matches!(self.language, ReferenceLanguage::Data(_))
    }
}

/// How a generated pack reads references without a book: `15:4` only, and
/// "," never joins a list (it may be a chapter/verse separator).
const DATA_SHORTHAND: Shorthand = Shorthand {
    bookless_separator: ":",
    verse_words: None,
    comma_joins_list: false,
};

/// Every pack: the six reviewed ones, then the generated ones
/// (`scripture::data_packs`) — 100 languages.
pub fn all() -> &'static [LanguagePack] {
    static ALL: OnceLock<Vec<LanguagePack>> = OnceLock::new();
    ALL.get_or_init(|| {
        let mut all: Vec<LanguagePack> = PACKS
            .iter()
            .map(|p| LanguagePack {
                language: p.language,
                scripts: p.scripts,
                shorthand: p.shorthand,
                ordinary_words: p.ordinary_words,
                reference_lead_ins: p.reference_lead_ins,
                reference_tails: p.reference_tails,
            })
            .collect();
        for (index, pack) in crate::scripture::data_packs::packs().iter().enumerate() {
            all.push(LanguagePack {
                language: ReferenceLanguage::Data(index as u8),
                scripts: pack.scripts,
                shorthand: DATA_SHORTHAND,
                ordinary_words: &[],
                reference_lead_ins: &[],
                reference_tails: &[],
            });
        }
        all
    })
}

/// The pack of a language.
pub fn pack(language: ReferenceLanguage) -> &'static LanguagePack {
    &all()[index_of(language)]
}

/// The index of a language's pack in [`all`] (for per-pack caches).
pub fn index_of(language: ReferenceLanguage) -> usize {
    match language {
        ReferenceLanguage::Data(index) => PACKS.len() + usize::from(index),
        reviewed => PACKS
            .iter()
            .position(|p| p.language == reviewed)
            .expect("every reviewed language has a pack"),
    }
}
