//! The languages Scripture references can be detected in.
//!
//! A source's `language` is whatever the person (or the file's metadata, via
//! `library::adapters::language_name`) said: "de", "de-DE", "deu", "Deutsch",
//! "German". [`ReferenceLanguage::from_label`] turns that into one of the six
//! languages that have a reviewed alias dictionary and notation, and nothing
//! else: it never guesses from the text, and it never looks at the interface
//! language. A source in an unrecognised language, or with none, is read with
//! the English dictionary ([`ReferenceLanguage::resolve`] says when that
//! happened); dictionaries are never merged.

use serde::Serialize;

/// A language with its own reference dictionary and notation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum ReferenceLanguage {
    En,
    De,
    Ko,
    Fr,
    Es,
    Pt,
}

/// The outcome of choosing a language for a source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resolved {
    pub language: ReferenceLanguage,
    /// The source named no recognised language, so English was used.
    pub fallback: bool,
}

impl ReferenceLanguage {
    pub const ALL: [Self; 6] = [Self::En, Self::De, Self::Ko, Self::Fr, Self::Es, Self::Pt];

    /// The ISO 639-1 code, e.g. `de`.
    pub fn code(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::De => "de",
            Self::Ko => "ko",
            Self::Fr => "fr",
            Self::Es => "es",
            Self::Pt => "pt",
        }
    }

    /// The language a metadata label names, or `None` when it names none of
    /// the six. Accepts BCP 47 tags (`en-GB`, `pt_BR`), ISO 639-2 codes
    /// (`deu`, `ger`, `fra`, `fre`), and names in the language itself or in
    /// English, German, French, Spanish or Portuguese ("Deutsch", "German",
    /// "Allemand", "Alemán", "Alemão", "독일어"), ignoring case and accents.
    /// Text after the name ("English (US)") is ignored.
    pub fn from_label(label: &str) -> Option<Self> {
        let folded = fold(label);
        let folded = folded.trim();
        if folded.is_empty() {
            return None;
        }
        Self::lookup(folded).or_else(|| {
            // "en-GB", "pt_BR", "English (US)", "Deutsch, Schweiz": the first word.
            let first = folded.split(|c: char| !c.is_alphanumeric()).next()?;
            if first.is_empty() || first == folded {
                None
            } else {
                Self::lookup(first)
            }
        })
    }

    fn lookup(name: &str) -> Option<Self> {
        Some(match name {
            "en" | "eng" | "english" | "englisch" | "anglais" | "ingles" | "영어" => Self::En,
            "de" | "deu" | "ger" | "deutsch" | "german" | "allemand" | "aleman" | "alemao"
            | "독일어" => Self::De,
            "ko" | "kor" | "한국어" | "korean" | "koreanisch" | "coreen" | "coreano" | "한국말" => {
                Self::Ko
            }
            "fr" | "fra" | "fre" | "francais" | "french" | "franzosisch" | "frances"
            | "프랑스어" => Self::Fr,
            "es" | "spa" | "espanol" | "spanish" | "spanisch" | "espagnol" | "castellano"
            | "espanhol" | "스페인어" => Self::Es,
            "pt" | "por" | "portugues" | "portuguese" | "portugiesisch" | "portugais"
            | "포르투갈어" => Self::Pt,
            _ => return None,
        })
    }

    /// The language to read a source with: the one its label names, or English
    /// (the long-standing behaviour) when it has none or an unrecognised one.
    pub fn resolve(label: Option<&str>) -> Resolved {
        match label.and_then(Self::from_label) {
            Some(language) => Resolved {
                language,
                fallback: false,
            },
            None => Resolved {
                language: Self::En,
                fallback: true,
            },
        }
    }
}

/// Lower case with the accents of the Latin-script languages removed, so
/// "Français", "FRANCAIS" and "francais" are one label.
pub fn fold(text: &str) -> String {
    text.chars()
        .flat_map(|c| c.to_lowercase())
        .map(fold_char)
        .collect()
}

/// The unaccented form of a lower-case letter (letters of the other scripts,
/// Hangul included, are left alone).
pub fn fold_char(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
        'é' | 'è' | 'ê' | 'ë' | 'ē' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'ī' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'ō' => 'o',
        'ú' | 'ù' | 'û' | 'ü' | 'ū' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ReferenceLanguage::{De, En, Es, Fr, Ko, Pt};

    #[test]
    fn every_form_in_the_brief_is_recognised() {
        let cases: [(&[&str], ReferenceLanguage); 6] = [
            (&["en", "en-GB", "en_US", "eng", "English"], En),
            (&["de", "de-DE", "deu", "ger", "Deutsch", "German"], De),
            (&["ko", "ko-KR", "kor", "한국어", "Korean"], Ko),
            (&["fr", "fr-FR", "fra", "fre", "Français", "French"], Fr),
            (&["es", "es-ES", "spa", "Español", "Spanish"], Es),
            (
                &["pt", "pt-BR", "pt-PT", "por", "Português", "Portuguese"],
                Pt,
            ),
        ];
        for (labels, language) in cases {
            for label in labels {
                assert_eq!(
                    ReferenceLanguage::from_label(label),
                    Some(language),
                    "{label}"
                );
            }
        }
    }

    #[test]
    fn case_accents_whitespace_and_trailing_words_do_not_matter() {
        for (label, language) in [
            ("  ENGLISH ", En),
            ("deutsch", De),
            ("Francais", Fr),
            ("ESPAÑOL", Es),
            ("espanol", Es),
            ("Portugues", Pt),
            ("PT_br", Pt),
            ("English (US)", En),
            ("Deutsch, Schweiz", De),
            ("한국어 (대한민국)", Ko),
        ] {
            assert_eq!(
                ReferenceLanguage::from_label(label),
                Some(language),
                "{label}"
            );
        }
    }

    #[test]
    fn names_in_the_other_languages_are_recognised() {
        for (label, language) in [
            ("Englisch", En),
            ("Anglais", En),
            ("Inglés", En),
            ("Koreanisch", Ko),
            ("Coréen", Ko),
            ("Coreano", Ko),
            ("Französisch", Fr),
            ("Francés", Fr),
            ("Spanisch", Es),
            ("Espagnol", Es),
            ("Espanhol", Es),
            ("Portugiesisch", Pt),
            ("Portugais", Pt),
            ("Alemão", De),
            ("Alemán", De),
            ("독일어", De),
            ("영어", En),
            ("프랑스어", Fr),
            ("스페인어", Es),
            ("포르투갈어", Pt),
        ] {
            assert_eq!(
                ReferenceLanguage::from_label(label),
                Some(language),
                "{label}"
            );
        }
    }

    #[test]
    fn anything_else_is_not_a_supported_language() {
        for label in [
            "",
            "   ",
            "Italiano",
            "it",
            "Nederlands",
            "Latina",
            "Ελληνικά",
            "עברית",
            "中文",
            "xx",
            "deutschland",
            "enough",
            "Italiano English",
        ] {
            assert_eq!(ReferenceLanguage::from_label(label), None, "{label:?}");
        }
    }

    #[test]
    fn what_the_library_stores_round_trips() {
        // adapters::language_name turns metadata tags into these names
        for (stored, language) in [
            ("English", En),
            ("Deutsch", De),
            ("Français", Fr),
            ("Español", Es),
            ("Português", Pt),
            ("한국어", Ko),
        ] {
            assert_eq!(ReferenceLanguage::from_label(stored), Some(language));
        }
    }

    #[test]
    fn a_missing_or_unrecognised_language_falls_back_to_english_and_says_so() {
        assert_eq!(
            ReferenceLanguage::resolve(None),
            Resolved {
                language: En,
                fallback: true
            }
        );
        assert_eq!(
            ReferenceLanguage::resolve(Some("")),
            Resolved {
                language: En,
                fallback: true
            }
        );
        assert_eq!(
            ReferenceLanguage::resolve(Some("Italiano")),
            Resolved {
                language: En,
                fallback: true
            }
        );
        assert_eq!(
            ReferenceLanguage::resolve(Some("de-AT")),
            Resolved {
                language: De,
                fallback: false
            }
        );
        assert_eq!(
            ReferenceLanguage::resolve(Some("English")),
            Resolved {
                language: En,
                fallback: false
            }
        );
    }

    #[test]
    fn codes_are_the_two_letter_identities() {
        let codes: Vec<_> = ReferenceLanguage::ALL.iter().map(|l| l.code()).collect();
        assert_eq!(codes, ["en", "de", "ko", "fr", "es", "pt"]);
        for language in ReferenceLanguage::ALL {
            assert_eq!(
                ReferenceLanguage::from_label(language.code()),
                Some(language)
            );
        }
    }
}
