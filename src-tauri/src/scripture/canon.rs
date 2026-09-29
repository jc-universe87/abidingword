//! The canonical book registry: the 66-book Protestant canon in English
//! (KJV-tradition) versification.
//!
//! Book codes are the three-character codes used in canonical references
//! such as `GEN.1.1`, `JHN.15.7`, `ROM.8.1` (docs/architecture.md §6); they
//! are the standard USFM/Paratext book identifiers. The ordinal is the stable
//! internal identifier (also the `bible_books.id` value).
//!
//! This table is the single source of truth. Migration 0002 seeds the same
//! data into `bible_books`; a test keeps the two identical.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Testament {
    #[serde(rename = "OT")]
    Old,
    #[serde(rename = "NT")]
    New,
}

impl Testament {
    pub fn code(self) -> &'static str {
        match self {
            Self::Old => "OT",
            Self::New => "NT",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Book {
    /// 1 = Genesis … 66 = Revelation.
    pub ordinal: u8,
    pub code: &'static str,
    pub testament: Testament,
    pub name: &'static str,
    pub chapter_count: u16,
    /// English abbreviations and alternative names, lower case, without
    /// the numeric prefix of numbered books (see `numbered`).
    pub aliases: &'static [&'static str],
    /// For 1–3 Samuel/Kings/…: the number in front of the name.
    pub number: Option<u8>,
}

impl Book {
    /// The name without its number, e.g. "Corinthians" for 1 Corinthians.
    pub fn base_name(&self) -> &'static str {
        match self.number {
            Some(_) => &self.name[2..],
            None => self.name,
        }
    }
}

use Testament::{New as NT, Old as OT};

macro_rules! book {
    ($ord:expr, $code:expr, $t:expr, $name:expr, $ch:expr, [$($alias:expr),*]) => {
        Book { ordinal: $ord, code: $code, testament: $t, name: $name, chapter_count: $ch,
               aliases: &[$($alias),*], number: None }
    };
    ($ord:expr, $code:expr, $t:expr, $name:expr, $ch:expr, $num:expr, [$($alias:expr),*]) => {
        Book { ordinal: $ord, code: $code, testament: $t, name: $name, chapter_count: $ch,
               aliases: &[$($alias),*], number: Some($num) }
    };
}

#[rustfmt::skip]
pub static BOOKS: [Book; 66] = [
    book!(1, "GEN", OT, "Genesis", 50, ["gen", "ge", "gn"]),
    book!(2, "EXO", OT, "Exodus", 40, ["exod", "exo", "ex"]),
    book!(3, "LEV", OT, "Leviticus", 27, ["lev", "le", "lv"]),
    book!(4, "NUM", OT, "Numbers", 36, ["num", "nu", "nm", "nb"]),
    book!(5, "DEU", OT, "Deuteronomy", 34, ["deut", "deu", "dt"]),
    book!(6, "JOS", OT, "Joshua", 24, ["josh", "jos", "jsh"]),
    book!(7, "JDG", OT, "Judges", 21, ["judg", "jdg", "jdgs", "jg"]),
    book!(8, "RUT", OT, "Ruth", 4, ["rth", "ru"]),
    book!(9, "1SA", OT, "1 Samuel", 31, 1, ["samuel", "sam", "sa", "sm"]),
    book!(10, "2SA", OT, "2 Samuel", 24, 2, ["samuel", "sam", "sa", "sm"]),
    book!(11, "1KI", OT, "1 Kings", 22, 1, ["kings", "kgs", "ki", "kg"]),
    book!(12, "2KI", OT, "2 Kings", 25, 2, ["kings", "kgs", "ki", "kg"]),
    book!(13, "1CH", OT, "1 Chronicles", 29, 1, ["chronicles", "chron", "chr", "ch"]),
    book!(14, "2CH", OT, "2 Chronicles", 36, 2, ["chronicles", "chron", "chr", "ch"]),
    book!(15, "EZR", OT, "Ezra", 10, ["ezr"]),
    book!(16, "NEH", OT, "Nehemiah", 13, ["neh", "ne"]),
    book!(17, "EST", OT, "Esther", 10, ["esth", "est", "es"]),
    book!(18, "JOB", OT, "Job", 42, ["jb"]),
    book!(19, "PSA", OT, "Psalms", 150, ["psalm", "psa", "pss", "psm", "ps"]),
    book!(20, "PRO", OT, "Proverbs", 31, ["prov", "pro", "prv", "pr"]),
    book!(21, "ECC", OT, "Ecclesiastes", 12, ["eccles", "eccl", "ecc", "ec", "qoheleth", "qoh"]),
    book!(22, "SNG", OT, "Song of Songs", 8, ["song of solomon", "song", "sos", "sng", "canticles", "cant"]),
    book!(23, "ISA", OT, "Isaiah", 66, ["isa"]),
    book!(24, "JER", OT, "Jeremiah", 52, ["jer", "je", "jr"]),
    book!(25, "LAM", OT, "Lamentations", 5, ["lam", "la"]),
    book!(26, "EZK", OT, "Ezekiel", 48, ["ezek", "eze", "ezk"]),
    book!(27, "DAN", OT, "Daniel", 12, ["dan", "da", "dn"]),
    book!(28, "HOS", OT, "Hosea", 14, ["hos", "ho"]),
    book!(29, "JOL", OT, "Joel", 3, ["jl"]),
    book!(30, "AMO", OT, "Amos", 9, ["amo"]),
    book!(31, "OBA", OT, "Obadiah", 1, ["obad", "oba", "ob"]),
    book!(32, "JON", OT, "Jonah", 4, ["jon", "jnh"]),
    book!(33, "MIC", OT, "Micah", 7, ["mic", "mc"]),
    book!(34, "NAM", OT, "Nahum", 3, ["nah", "nam", "na"]),
    book!(35, "HAB", OT, "Habakkuk", 3, ["hab", "hb"]),
    book!(36, "ZEP", OT, "Zephaniah", 3, ["zeph", "zep", "zp"]),
    book!(37, "HAG", OT, "Haggai", 2, ["hag", "hg"]),
    book!(38, "ZEC", OT, "Zechariah", 14, ["zech", "zec", "zc"]),
    book!(39, "MAL", OT, "Malachi", 4, ["mal", "ml"]),
    book!(40, "MAT", NT, "Matthew", 28, ["matt", "mat", "mt"]),
    book!(41, "MRK", NT, "Mark", 16, ["mrk", "mk"]),
    book!(42, "LUK", NT, "Luke", 24, ["luk", "lk"]),
    book!(43, "JHN", NT, "John", 21, ["jhn", "joh", "jn"]),
    book!(44, "ACT", NT, "Acts", 28, ["act", "ac"]),
    book!(45, "ROM", NT, "Romans", 16, ["rom", "ro", "rm"]),
    book!(46, "1CO", NT, "1 Corinthians", 16, 1, ["corinthians", "cor", "co"]),
    book!(47, "2CO", NT, "2 Corinthians", 13, 2, ["corinthians", "cor", "co"]),
    book!(48, "GAL", NT, "Galatians", 6, ["gal", "ga"]),
    book!(49, "EPH", NT, "Ephesians", 6, ["ephes", "eph"]),
    book!(50, "PHP", NT, "Philippians", 4, ["phil", "php", "pp"]),
    book!(51, "COL", NT, "Colossians", 4, ["col"]),
    book!(52, "1TH", NT, "1 Thessalonians", 5, 1, ["thessalonians", "thess", "thes", "th"]),
    book!(53, "2TH", NT, "2 Thessalonians", 3, 2, ["thessalonians", "thess", "thes", "th"]),
    book!(54, "1TI", NT, "1 Timothy", 6, 1, ["timothy", "tim", "ti", "tm"]),
    book!(55, "2TI", NT, "2 Timothy", 4, 2, ["timothy", "tim", "ti", "tm"]),
    book!(56, "TIT", NT, "Titus", 3, ["tit"]),
    book!(57, "PHM", NT, "Philemon", 1, ["philem", "phlm", "phm"]),
    book!(58, "HEB", NT, "Hebrews", 13, ["heb"]),
    book!(59, "JAS", NT, "James", 5, ["jas", "jm"]),
    book!(60, "1PE", NT, "1 Peter", 5, 1, ["peter", "pet", "pe", "pt"]),
    book!(61, "2PE", NT, "2 Peter", 3, 2, ["peter", "pet", "pe", "pt"]),
    book!(62, "1JN", NT, "1 John", 5, 1, ["john", "jhn", "joh", "jn"]),
    book!(63, "2JN", NT, "2 John", 1, 2, ["john", "jhn", "joh", "jn"]),
    book!(64, "3JN", NT, "3 John", 1, 3, ["john", "jhn", "joh", "jn"]),
    book!(65, "JUD", NT, "Jude", 1, ["jud"]),
    book!(66, "REV", NT, "Revelation", 22, ["revelations", "rev", "re", "apocalypse"]),
];

pub fn by_code(code: &str) -> Option<&'static Book> {
    BOOKS.iter().find(|b| b.code.eq_ignore_ascii_case(code))
}

pub fn by_ordinal(ordinal: u8) -> Option<&'static Book> {
    BOOKS.get(usize::from(ordinal).checked_sub(1)?)
}

/// USFM identifiers of books outside the 66-book canon (front matter,
/// glossaries, deuterocanonical books…). Importers skip them with a note
/// instead of reporting an unknown book.
pub const NON_CANONICAL_USFM_CODES: &[&str] = &[
    "FRT", "BAK", "OTH", "INT", "CNC", "GLO", "TDX", "NDX", "XXA", "XXB", "XXC", "XXD", "XXE",
    "XXF", "XXG", "TOB", "JDT", "ESG", "WIS", "SIR", "BAR", "LJE", "S3Y", "SUS", "BEL", "1MA",
    "2MA", "3MA", "4MA", "1ES", "2ES", "MAN", "PS2", "ODA", "PSS", "EZA", "5EZ", "6EZ", "DAG",
    "PS3", "2BA", "LBA", "JUB", "ENO", "1MQ", "2MQ", "3MQ", "REP", "4BA", "LAO",
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn there_are_66_books_in_canonical_order() {
        assert_eq!(BOOKS.len(), 66);
        for (index, book) in BOOKS.iter().enumerate() {
            assert_eq!(usize::from(book.ordinal), index + 1, "{}", book.code);
        }
        assert_eq!(BOOKS[0].code, "GEN");
        assert_eq!(BOOKS[38].code, "MAL");
        assert_eq!(BOOKS[39].code, "MAT");
        assert_eq!(BOOKS[65].code, "REV");
    }

    #[test]
    fn codes_are_unique_three_character_identifiers() {
        let codes: HashSet<_> = BOOKS.iter().map(|b| b.code).collect();
        assert_eq!(codes.len(), 66);
        for book in &BOOKS {
            assert_eq!(book.code.len(), 3, "{}", book.code);
            assert_eq!(book.code, book.code.to_ascii_uppercase());
        }
        for code in ["GEN", "EXO", "PSA", "ISA", "MAT", "JHN", "ROM", "REV"] {
            assert!(by_code(code).is_some(), "{code}");
        }
    }

    #[test]
    fn chapter_counts_match_the_english_canon() {
        assert!(BOOKS.iter().all(|b| b.chapter_count >= 1));
        let ot: u32 = BOOKS
            .iter()
            .filter(|b| b.testament == Testament::Old)
            .map(|b| u32::from(b.chapter_count))
            .sum();
        let nt: u32 = BOOKS
            .iter()
            .filter(|b| b.testament == Testament::New)
            .map(|b| u32::from(b.chapter_count))
            .sum();
        assert_eq!(ot, 929);
        assert_eq!(nt, 260);
        assert_eq!(by_code("PSA").unwrap().chapter_count, 150);
        assert_eq!(by_code("JUD").unwrap().chapter_count, 1);
    }

    #[test]
    fn testaments_split_at_matthew() {
        assert_eq!(
            BOOKS
                .iter()
                .filter(|b| b.testament == Testament::Old)
                .count(),
            39
        );
        assert_eq!(
            BOOKS
                .iter()
                .filter(|b| b.testament == Testament::New)
                .count(),
            27
        );
        assert!(BOOKS[..39].iter().all(|b| b.testament == Testament::Old));
    }

    #[test]
    fn numbered_books_carry_their_number() {
        let first_cor = by_code("1CO").unwrap();
        assert_eq!(first_cor.number, Some(1));
        assert_eq!(first_cor.base_name(), "Corinthians");
        assert_eq!(by_code("3JN").unwrap().base_name(), "John");
        assert!(NON_CANONICAL_USFM_CODES
            .iter()
            .all(|c| by_code(c).is_none()));
    }
}
