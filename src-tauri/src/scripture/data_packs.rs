//! The data-driven Bible-reference language packs (v0.18.2).
//!
//! `resources/scripture/reference-packs.json` is written by
//! `scripts/scripture/build_reference_packs.py` from published sources (see
//! its provenance block and `docs/reference-language-packs.md`): which 100
//! languages (Unicode CLDR population data), and their book names and
//! abbreviations (OpenBible.info Bible Passage Reference Parser data, MIT).
//! Six of the 100 — English, German, Korean, French, Spanish, Portuguese —
//! keep their hand-reviewed dictionaries (`scripture::aliases`); the other 94
//! are read from the file here, once, into the same [`AliasDictionary`] form,
//! so one engine reads every language.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::scripture::canon::{self, Book};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::packs::Script;
use crate::scripture::parser::{AliasDictionary, AliasEntry, Grammar, Strictness, Syntax};

const DATA: &str = include_str!("../../../resources/scripture/reference-packs.json");

#[derive(Deserialize)]
struct File {
    packs: Vec<RawPack>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawAlias {
    Plain(String),
    Exact { text: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPack {
    iso3: String,
    code: String,
    name: String,
    #[serde(default)]
    native: Option<String>,
    rank: u32,
    #[serde(default)]
    curated: Option<String>,
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    scripts: Vec<String>,
    #[serde(default)]
    spaced: Option<bool>,
    #[serde(default)]
    chapter_units: Vec<String>,
    #[serde(default)]
    verse_units: Vec<String>,
    #[serde(default)]
    books: std::collections::BTreeMap<String, Vec<RawAlias>>,
    #[serde(default)]
    ambiguous: std::collections::BTreeMap<String, Vec<String>>,
}

/// One generated language pack.
#[derive(Debug)]
pub struct DataPack {
    /// ISO 639-3 code of the data ("pol", "arb").
    pub iso3: &'static str,
    /// The CLDR language code ("pl", "ar").
    pub code: &'static str,
    /// English name ("Polish").
    pub name: &'static str,
    /// Place in the 100 (by speakers).
    pub rank: u32,
    pub script: Script,
    pub scripts: &'static [Script],
    /// Words are separated by spaces (not Chinese, Japanese, Thai, Khmer…).
    pub spaced: bool,
    pub chapter_units: &'static [&'static str],
    pub verse_units: &'static [&'static str],
    /// `(book code, aliases, exact)`: an exact alias keeps its accents.
    pub books: Vec<(&'static Book, &'static str, bool)>,
    /// Spellings that name two books in this language: never read as either.
    pub ambiguous: Vec<(&'static str, Vec<&'static Book>)>,
}

/// One of the 100, in rank order: the reviewed six as their own languages,
/// the others as generated packs.
#[derive(Debug, Clone, Copy)]
pub struct Listed {
    pub rank: u32,
    pub code: &'static str,
    pub iso3: &'static str,
    pub name: &'static str,
    /// The name in the language itself (CLDR), when known.
    pub native: Option<&'static str>,
    pub language: ReferenceLanguage,
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

struct Loaded {
    packs: Vec<DataPack>,
    listed: Vec<Listed>,
}

fn loaded() -> &'static Loaded {
    static LOADED: OnceLock<Loaded> = OnceLock::new();
    LOADED.get_or_init(|| {
        let file: File = serde_json::from_str(DATA).expect("reference-packs.json is valid");
        let mut packs = Vec::new();
        let mut listed = Vec::new();
        for raw in file.packs {
            let code = leak(raw.code);
            let iso3 = leak(raw.iso3);
            let name = leak(raw.name);
            let native = raw.native.map(leak);
            if let Some(curated) = raw.curated {
                let language = ReferenceLanguage::reviewed_from_code(&curated)
                    .expect("a curated pack names a reviewed language");
                listed.push(Listed {
                    rank: raw.rank,
                    code,
                    iso3,
                    name,
                    native,
                    language,
                });
                continue;
            }
            let index = u8::try_from(packs.len()).expect("fewer than 256 packs");
            let scripts: Vec<Script> = raw
                .scripts
                .iter()
                .filter_map(|s| Script::from_name(s))
                .collect();
            let script = raw
                .script
                .as_deref()
                .and_then(Script::from_name)
                .unwrap_or(Script::Latin);
            let mut books = Vec::new();
            for (book_code, aliases) in raw.books {
                let Some(book) = canon::by_code(&book_code) else {
                    continue;
                };
                for alias in aliases {
                    let (text, exact) = match alias {
                        RawAlias::Plain(t) => (t, false),
                        RawAlias::Exact { text } => (text, true),
                    };
                    books.push((book, leak(text), exact));
                }
            }
            let ambiguous = raw
                .ambiguous
                .into_iter()
                .map(|(alias, codes)| {
                    (
                        leak(alias),
                        codes.iter().filter_map(|c| canon::by_code(c)).collect(),
                    )
                })
                .collect();
            let leak_list = |list: Vec<String>| -> &'static [&'static str] {
                Box::leak(
                    list.into_iter()
                        .map(leak)
                        .collect::<Vec<_>>()
                        .into_boxed_slice(),
                )
            };
            packs.push(DataPack {
                iso3,
                code,
                name,
                rank: raw.rank,
                script,
                scripts: Box::leak(
                    if scripts.is_empty() {
                        vec![script]
                    } else {
                        scripts
                    }
                    .into_boxed_slice(),
                ),
                spaced: raw.spaced.unwrap_or(true),
                chapter_units: leak_list(raw.chapter_units),
                verse_units: leak_list(raw.verse_units),
                books,
                ambiguous,
            });
            listed.push(Listed {
                rank: raw.rank,
                code,
                iso3,
                name,
                native,
                language: ReferenceLanguage::Data(index),
            });
        }
        listed.sort_by_key(|l| l.rank);
        Loaded { packs, listed }
    })
}

/// The generated packs (94), in the file's order (by rank).
pub fn packs() -> &'static [DataPack] {
    &loaded().packs
}

pub fn get(index: u8) -> &'static DataPack {
    &loaded().packs[usize::from(index)]
}

/// All 100 reference languages, by rank (speakers).
pub fn listed() -> &'static [Listed] {
    &loaded().listed
}

/// Han-script references also count chapters with 章 and verses with 节/節
/// (the established notation; the book-name data does not carry it).
const HAN_CHAPTER: &[&str] = &["章"];
const HAN_VERSE: &[&str] = &["节", "節"];

fn units(
    pack: &DataPack,
    own: &'static [&'static str],
    han: &'static [&'static str],
) -> &'static [&'static str] {
    if pack.scripts.contains(&Script::Han) && own.is_empty() {
        han
    } else {
        own
    }
}

/// The dictionary of a generated pack. A short abbreviation (one or two
/// letters) needs a verse in running text, as the reviewed packs ask of
/// their short ordinary-word abbreviations.
pub fn dictionary(index: u8) -> AliasDictionary {
    let pack = get(index);
    let entries = pack
        .books
        .iter()
        .map(|(book, alias, _)| {
            let letters = alias.chars().filter(|c| c.is_alphabetic()).count();
            AliasEntry {
                alias: (*alias).to_string(),
                book,
                strictness: if letters <= 2 {
                    Strictness::Verse
                } else {
                    Strictness::Full
                },
            }
        })
        .collect();
    let exact: Vec<&'static str> = pack
        .books
        .iter()
        .filter(|(_, _, e)| *e)
        .map(|(_, a, _)| *a)
        .collect();
    AliasDictionary {
        language: ReferenceLanguage::Data(index),
        entries,
        syntax: Syntax {
            grammar: Grammar::Data,
            verse_separator: r"\s*:\s*|[.,]",
            number_join: Some(r"\.?\s*"),
            require_capital: pack.script.is_cased(),
            no_fold: Box::leak(exact.into_boxed_slice()),
            spaced: pack.spaced,
            chapter_units: units(pack, pack.chapter_units, HAN_CHAPTER),
            verse_units: units(pack, pack.verse_units, HAN_VERSE),
        },
        ambiguous: pack
            .ambiguous
            .iter()
            .map(|(alias, books)| ((*alias).to_string(), books.clone()))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_lists_one_hundred_languages_by_rank_with_the_reviewed_six_among_them() {
        let listed = listed();
        assert_eq!(listed.len(), 100);
        assert_eq!(packs().len(), 94);
        let ranks: Vec<u32> = listed.iter().map(|l| l.rank).collect();
        assert_eq!(ranks, (1..=100).collect::<Vec<_>>());
        for reviewed in ReferenceLanguage::REVIEWED {
            assert!(
                listed.iter().any(|l| l.language == reviewed),
                "{reviewed:?}"
            );
        }
    }

    #[test]
    fn every_generated_alias_names_a_book_of_the_canon_and_no_spelling_names_two() {
        for (i, pack) in packs().iter().enumerate() {
            assert!(!pack.books.is_empty(), "{}", pack.iso3);
            let dictionary = dictionary(i as u8);
            assert!(!dictionary.entries.is_empty());
            for (alias, books) in &pack.ambiguous {
                assert!(books.len() > 1, "{} {alias}", pack.iso3);
            }
        }
    }
}
