//! The languages Scripture references can be detected in.
//!
//! A source's `language` is whatever the person (or the file's metadata, via
//! `library::adapters::language_name`) said: "de", "de-DE", "deu", "Deutsch",
//! "German", "pl", "Polish". [`ReferenceLanguage::from_label`] turns that into
//! one of the 100 reference languages (`scripture::data_packs`): the six with a
//! hand-reviewed dictionary by name in several languages, the others by their
//! codes and English name. It never guesses from the text, and it never looks
//! at the interface language. A source in an unrecognised language, or with
//! none, is read with the English dictionary ([`ReferenceLanguage::resolve`]
//! says when that happened); dictionaries are never merged.

use serde::{Serialize, Serializer};

/// A language with its own reference dictionary and notation: one of the six
/// reviewed ones, or a generated pack (`Data`, an index into
/// `scripture::data_packs::packs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReferenceLanguage {
    En,
    De,
    Ko,
    Fr,
    Es,
    Pt,
    Data(u8),
}

impl Serialize for ReferenceLanguage {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.code())
    }
}

/// The outcome of choosing a language for a source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resolved {
    pub language: ReferenceLanguage,
    /// The source named no recognised language, so English was used.
    pub fallback: bool,
}

impl ReferenceLanguage {
    /// The six languages with a hand-reviewed dictionary.
    pub const REVIEWED: [Self; 6] = [Self::En, Self::De, Self::Ko, Self::Fr, Self::Es, Self::Pt];

    /// All 100 reference languages, by rank (speakers).
    pub fn all() -> impl Iterator<Item = Self> {
        crate::scripture::data_packs::listed()
            .iter()
            .map(|l| l.language)
    }

    /// The language code: ISO 639-1 where there is one (`de`, `pl`), else the
    /// CLDR code (`fil`, `yue`).
    pub fn code(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::De => "de",
            Self::Ko => "ko",
            Self::Fr => "fr",
            Self::Es => "es",
            Self::Pt => "pt",
            Self::Data(index) => crate::scripture::data_packs::get(index).code,
        }
    }

    /// A reviewed language by its two-letter code.
    pub fn reviewed_from_code(code: &str) -> Option<Self> {
        Self::REVIEWED.into_iter().find(|l| l.code() == code)
    }

    /// The English name ("German", "Polish").
    pub fn name(self) -> &'static str {
        crate::scripture::data_packs::listed()
            .iter()
            .find(|l| l.language == self)
            .map_or("English", |l| l.name)
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
        Self::lookup_reviewed(name).or_else(|| {
            // The generated languages: their codes and English name ("pl", "pol", "polish").
            crate::scripture::data_packs::listed()
                .iter()
                .find(|l| {
                    matches!(l.language, Self::Data(_))
                        && (l.code == name
                            || l.iso3 == name
                            || fold(l.name) == name
                            || l.native.is_some_and(|n| fold(n) == name))
                })
                .map(|l| l.language)
        })
    }

    fn lookup_reviewed(name: &str) -> Option<Self> {
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

/// A stored language tag, well formed (BCP 47 in its common shapes): a
/// primary language of two or three letters, then optionally a script
/// (`Hant`), a region (`BR`, `419`) and variants. Case is normalised
/// (`PT_br` → `pt-BR`), a three-letter code with a two-letter one becomes
/// it (`deu` → `de`, as BCP 47 asks), an extended language becomes the
/// language (`zh-yue-HK` → `yue-HK`), and extensions and private use after
/// the language are dropped (`en-US-u-ca-gregory` → `en-US`). Anything else —
/// a name such as "Português", an empty value, "und"/"mul"/"zxx"/"mis", a
/// private-use language (`qaa`–`qtz`, `x-…`) — is no tag at all. A tag says
/// what a Bible *is*; nothing here guesses it.
pub fn normalise_tag(input: &str) -> Option<String> {
    let input = input.trim();
    if input.is_empty() || input.len() > 35 {
        return None;
    }
    let mut parts = input.split(['-', '_']);
    let primary = parts.next()?.to_ascii_lowercase();
    if !(2..=3).contains(&primary.len())
        || !primary.chars().all(|c| c.is_ascii_alphabetic())
        || matches!(primary.as_str(), "und" | "mul" | "zxx" | "mis")
        || (primary.len() == 3 && ("qaa"..="qtz").contains(&primary.as_str()))
    {
        return None;
    }
    let mut out = vec![primary];
    let mut stage = 0; // 0: script next, 1: region next, 2: variants
    let mut extlang = false;
    for part in parts {
        let alnum = part.chars().all(|c| c.is_ascii_alphanumeric());
        let alpha = part.chars().all(|c| c.is_ascii_alphabetic());
        let digits = part.chars().all(|c| c.is_ascii_digit());
        if part.len() == 1 {
            // An extension or private use ("-u-…", "-x-…"): the tag ends here.
            break;
        }
        if stage == 0 && !extlang && part.len() == 3 && alpha {
            out[0] = part.to_ascii_lowercase();
            extlang = true;
        } else if stage == 0 && part.len() == 4 && alpha {
            out.push(format!(
                "{}{}",
                part[..1].to_ascii_uppercase(),
                part[1..].to_ascii_lowercase()
            ));
            stage = 1;
        } else if stage <= 1 && ((part.len() == 2 && alpha) || (part.len() == 3 && digits)) {
            out.push(part.to_ascii_uppercase());
            stage = 2;
        } else if alnum
            && ((5..=8).contains(&part.len())
                || (part.len() == 4 && part.starts_with(|c: char| c.is_ascii_digit())))
        {
            out.push(part.to_ascii_lowercase());
            stage = 2;
        } else {
            // A malformed part: not a tag.
            return None;
        }
    }
    // The shortest code for the language: "deu", "ger" → "de".
    if out[0].len() == 3 {
        if let Some(code) = crate::scripture::resolve::language_of_tag(Some(&out[0]))
            .map(ReferenceLanguage::code)
            .filter(|c| c.len() == 2)
        {
            out[0] = code.to_string();
        }
    }
    Some(out.join("-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_tags_are_normalised_and_names_are_not_tags() {
        for (input, expected) in [
            ("pt", Some("pt")),
            ("PT_br", Some("pt-BR")),
            ("zh-hant-tw", Some("zh-Hant-TW")),
            ("es-419", Some("es-419")),
            ("deu", Some("de")),
            ("ger-CH", Some("de-CH")),
            ("fra", Some("fr")),
            ("por", Some("pt")),
            ("tpi", Some("tpi")),
            ("en-US-x-twain", Some("en-US")),
            ("en-US-u-ca-gregory", Some("en-US")),
            ("en-a-bbb", Some("en")),
            ("zh-yue-HK", Some("yue-HK")),
            ("qaa", None),
            ("qtz-Latn", None),
            (" ko ", Some("ko")),
            ("de-1996", Some("de-1996")),
            ("Português", None),
            ("Deutsch", None),
            ("", None),
            ("und", None),
            ("mul", None),
            ("x-foo", None),
            ("en-x-private", Some("en")),
            ("e", None),
            ("12", None),
            ("en--US", None),
        ] {
            assert_eq!(normalise_tag(input).as_deref(), expected, "{input:?}");
        }
    }
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
        for label in ["", "   ", "Latina", "xx", "deutschland", "enough"] {
            assert_eq!(ReferenceLanguage::from_label(label), None, "{label:?}");
        }
    }

    #[test]
    fn the_other_reference_languages_are_found_by_code_and_name() {
        for (label, code) in [
            ("it", "it"),
            ("Italiano", "it"),
            ("Italian", "it"),
            ("nl", "nl"),
            ("Nederlands", "nl"),
            ("pol", "pl"),
            ("Polish", "pl"),
            ("Ελληνικά", "el"),
            ("עברית", "he"),
            ("中文", "zh"),
            ("ar-EG", "ar"),
            ("日本語", "ja"),
        ] {
            let language =
                ReferenceLanguage::from_label(label).unwrap_or_else(|| panic!("{label}"));
            assert!(matches!(language, ReferenceLanguage::Data(_)), "{label}");
            assert_eq!(language.code(), code, "{label}");
        }
        assert_eq!(ReferenceLanguage::all().count(), 100);
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
            ReferenceLanguage::resolve(Some("Latina")),
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
        let codes: Vec<_> = ReferenceLanguage::REVIEWED
            .iter()
            .map(|l| l.code())
            .collect();
        assert_eq!(codes, ["en", "de", "ko", "fr", "es", "pt"]);
        for language in ReferenceLanguage::REVIEWED {
            assert_eq!(
                ReferenceLanguage::from_label(language.code()),
                Some(language)
            );
        }
    }
}
