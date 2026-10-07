//! Book-name dictionaries and notation, one per supported language.
//!
//! Every dictionary maps names and standard abbreviations onto the same 66-book
//! canon, so a reference found in any language comes out as the same canonical
//! `ScriptureRef`. They are written for precision: an abbreviation that is also
//! an ordinary word of its own language is left out (each file lists what it
//! omits and why), because a wrong source suggestion costs more trust than a
//! missed one. They are curated by hand from the standard names and
//! abbreviations of each language's common Bible translations; they have not
//! been certified by a linguist.
//!
//! Dictionaries are never combined: [`dictionary`] returns the one for a
//! language and `ReferenceParser::for_language` builds one parser from it.

mod de;
mod es;
mod fr;
mod ko;
mod pt;

use crate::scripture::canon::{self, Book};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::{AliasDictionary, AliasEntry, Grammar, Strictness, Syntax};

/// `(book code, aliases)`. For a numbered book the aliases are the names
/// without the number; the builder adds "1 …", "2 …", "3 …" (and Roman forms).
/// Other books list every spelling, including ones that start with a number
/// ("1 mose" for Genesis).
pub(super) type Row = (&'static str, &'static [&'static str]);

pub fn dictionary(language: ReferenceLanguage) -> AliasDictionary {
    match language {
        ReferenceLanguage::En => AliasDictionary::english(),
        ReferenceLanguage::De => de::dictionary(),
        ReferenceLanguage::Ko => ko::dictionary(),
        ReferenceLanguage::Fr => fr::dictionary(),
        ReferenceLanguage::Es => es::dictionary(),
        ReferenceLanguage::Pt => pt::dictionary(),
    }
}

fn book(code: &str) -> &'static Book {
    canon::by_code(code).unwrap_or_else(|| panic!("unknown book code {code}"))
}

fn roman(number: u8) -> &'static str {
    match number {
        1 => "i",
        2 => "ii",
        _ => "iii",
    }
}

/// A Latin-script dictionary from its rows.
pub(super) fn latin(
    language: ReferenceLanguage,
    rows: &[Row],
    roman_numerals: bool,
    syntax: Syntax,
) -> AliasDictionary {
    let mut entries = Vec::new();
    let mut push = |alias: String, book: &'static Book| {
        entries.push(AliasEntry {
            alias,
            book,
            strictness: Strictness::Full,
        });
    };
    for (code, names) in rows {
        let book = book(code);
        for name in *names {
            match book.number {
                Some(number) => {
                    push(format!("{number} {name}"), book);
                    if roman_numerals {
                        push(format!("{} {name}", roman(number)), book);
                    }
                }
                None => push((*name).to_string(), book),
            }
        }
    }
    AliasDictionary {
        language,
        entries,
        syntax,
    }
}

/// The notation shared by the Latin-script languages that write `Book 3,16`
/// and `Book 3:16` (German, French, Spanish, Portuguese).
pub(super) fn comma_syntax(number_join: &'static str, no_fold: &'static [&'static str]) -> Syntax {
    Syntax {
        grammar: Grammar::Latin,
        verse_separator: r"\s*:\s*|,",
        number_join: Some(number_join),
        require_capital: true,
        no_fold,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scripture::canon::BOOKS;
    use crate::scripture::parser::{accent_collisions, ReferenceParser};
    use std::collections::HashSet;

    #[test]
    fn every_language_names_all_66_books() {
        for language in ReferenceLanguage::ALL {
            let dictionary = dictionary(language);
            let named: HashSet<_> = dictionary.entries.iter().map(|e| e.book.code).collect();
            let missing: Vec<_> = BOOKS
                .iter()
                .map(|b| b.code)
                .filter(|code| !named.contains(code))
                .collect();
            assert!(
                missing.is_empty(),
                "{language:?} has no alias for {missing:?}"
            );
        }
    }

    #[test]
    fn no_alias_points_at_two_books_within_a_language() {
        for language in ReferenceLanguage::ALL {
            let dictionary = dictionary(language);
            assert_eq!(dictionary.collisions(), vec![], "{language:?}");
        }
    }

    #[test]
    fn no_accent_free_spelling_points_at_two_books_unless_the_exact_spelling_decides() {
        // "Jo" (João) and "Jó" (Jó) differ only by an accent: the parser keeps both
        // exact and drops the accent-free reading of the one that would collide.
        for language in ReferenceLanguage::ALL {
            let dictionary = dictionary(language);
            let clashes = accent_collisions(&dictionary);
            let parser = ReferenceParser::for_language(language);
            for key in clashes {
                // the accent-free form must still resolve to at most one of them
                let found = parser.detect(&format!("{} 3", capitalise(&key)));
                assert!(found.len() <= 1, "{language:?}: {key}");
            }
        }
    }

    fn capitalise(text: &str) -> String {
        let mut chars = text.chars();
        chars
            .next()
            .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
            .unwrap_or_default()
    }

    #[test]
    fn every_book_is_reachable_by_its_own_first_alias_in_every_language() {
        for language in ReferenceLanguage::ALL {
            let dictionary = dictionary(language);
            let parser = ReferenceParser::for_language(language);
            for book in &BOOKS {
                let entry = dictionary
                    .entries
                    .iter()
                    .filter(|e| e.book.code == book.code)
                    .max_by_key(|e| (e.strictness == Strictness::Full, e.alias.chars().count()))
                    .unwrap();
                let text = match language {
                    ReferenceLanguage::Ko => format!("{} 1:1", entry.alias),
                    _ => format!("{} 1:1", capitalise(&entry.alias)),
                };
                let found = parser.detect(&text);
                let canonical: Vec<_> = found.iter().map(|d| d.reference.book).collect();
                // a one-chapter book also accepts "1:1"; every book has a chapter 1
                assert_eq!(
                    canonical,
                    [book.code.to_string()],
                    "{language:?}: {text:?} should name {}",
                    book.code
                );
            }
        }
    }
}
