//! Korean: 개역개정-style book names and the standard abbreviations.
//! Notation: `요한복음 3:16`, `요한복음 3장 16절`, `요한복음 3장 16-18절`,
//! `요한복음 3장`, `시편 23편`, `롬 8:28`, `롬8:28`, `3:16~18`, `빌레몬서 6절`.
//! Hangul has no capital letters, so Korean does not use the Latin "starts with a
//! capital" check; instead a reference must stand on its own (not inside a longer
//! word, not followed by more digits) and each alias says how much of a reference
//! it needs:
//!
//! * **Full** – a book name: `요한복음 3` is enough (unless it runs straight into
//!   more Korean, as in "3권").
//! * **Unit** – a distinctive abbreviation: needs `8장`/`23편` or a verse (`롬 8장`,
//!   `롬 8:28`).
//! * **Verse** – a one-syllable abbreviation that is also an ordinary word: needs a
//!   chapter with a verse (`요 3:16`, `시 23:1`, `요 3장 16절`), so "요 3개" and "시 3편 이후"
//!   are not references.
//!
//! Left out on purpose, because they are common words or particles: 수 (여호수아),
//! 스 (에스라), 느 (느헤미야), 에 (에스더; the particle 에), 전 (전도서; "before"),
//! 아 (아가), 단 (다니엘; "but"), 나 (나훔; "I"), 약 (야고보서; "about": "약 3:30").
//! Those books are still found by their full names. The bare name "요한" (a
//! person's name) is not an alias; 요한복음 and 요한일서/이서/삼서 are.

use super::book;
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::{AliasDictionary, AliasEntry, Grammar, Strictness, Syntax};

/// Book names. A short, name-like word (아가, 요나…) needs a unit or verse.
const NAMES: &[(&str, &[&str])] = &[
    ("GEN", &["창세기"]),
    ("EXO", &["출애굽기"]),
    ("LEV", &["레위기"]),
    ("NUM", &["민수기"]),
    ("DEU", &["신명기"]),
    ("JOS", &["여호수아"]),
    ("JDG", &["사사기"]),
    ("RUT", &["룻기"]),
    ("1SA", &["사무엘상"]),
    ("2SA", &["사무엘하"]),
    ("1KI", &["열왕기상"]),
    ("2KI", &["열왕기하"]),
    ("1CH", &["역대상"]),
    ("2CH", &["역대하"]),
    ("EZR", &["에스라"]),
    ("NEH", &["느헤미야"]),
    ("EST", &["에스더"]),
    ("JOB", &["욥기"]),
    ("PSA", &["시편"]),
    ("PRO", &["잠언"]),
    ("ECC", &["전도서"]),
    ("ISA", &["이사야"]),
    ("JER", &["예레미야"]),
    ("LAM", &["예레미야애가", "예레미야 애가"]),
    ("EZK", &["에스겔"]),
    ("DAN", &["다니엘"]),
    ("HOS", &["호세아"]),
    ("AMO", &["아모스"]),
    ("OBA", &["오바댜"]),
    ("HAB", &["하박국"]),
    ("ZEP", &["스바냐"]),
    ("ZEC", &["스가랴"]),
    ("MAL", &["말라기"]),
    ("MAT", &["마태복음"]),
    ("MRK", &["마가복음"]),
    ("LUK", &["누가복음"]),
    ("JHN", &["요한복음"]),
    ("ACT", &["사도행전"]),
    ("ROM", &["로마서"]),
    ("1CO", &["고린도전서"]),
    ("2CO", &["고린도후서"]),
    ("GAL", &["갈라디아서"]),
    ("EPH", &["에베소서"]),
    ("PHP", &["빌립보서"]),
    ("COL", &["골로새서"]),
    ("1TH", &["데살로니가전서"]),
    ("2TH", &["데살로니가후서"]),
    ("1TI", &["디모데전서"]),
    ("2TI", &["디모데후서"]),
    ("TIT", &["디도서"]),
    ("PHM", &["빌레몬서"]),
    ("HEB", &["히브리서"]),
    ("JAS", &["야고보서"]),
    ("1PE", &["베드로전서"]),
    ("2PE", &["베드로후서"]),
    ("1JN", &["요한일서", "요한1서"]),
    ("2JN", &["요한이서", "요한2서"]),
    ("3JN", &["요한삼서", "요한3서"]),
    ("JUD", &["유다서"]),
    ("REV", &["요한계시록"]),
];

/// Two-syllable names that are also ordinary words or names.
const SHORT_NAMES: &[(&str, &[&str])] = &[
    ("SNG", &["아가"]),
    ("JOL", &["요엘"]),
    ("JON", &["요나"]),
    ("MIC", &["미가"]),
    ("NAM", &["나훔"]),
    ("HAG", &["학개"]),
];

/// Distinctive abbreviations: a chapter unit or a verse is required.
const ABBREVIATIONS: &[(&str, &[&str])] = &[
    ("GEN", &["창"]),
    ("EXO", &["출"]),
    ("LEV", &["레"]),
    ("NUM", &["민"]),
    ("JDG", &["삿"]),
    ("RUT", &["룻"]),
    ("1SA", &["삼상"]),
    ("2SA", &["삼하"]),
    ("1KI", &["왕상"]),
    ("2KI", &["왕하"]),
    ("1CH", &["대상"]),
    ("2CH", &["대하"]),
    ("JOB", &["욥"]),
    ("JER", &["렘"]),
    ("EZK", &["겔"]),
    ("JOL", &["욜"]),
    ("OBA", &["옵"]),
    ("JON", &["욘"]),
    ("ZEC", &["슥"]),
    ("ZEP", &["습"]),
    ("LUK", &["눅"]),
    ("MRK", &["막"]),
    ("ROM", &["롬"]),
    ("1CO", &["고전"]),
    ("2CO", &["고후"]),
    ("EPH", &["엡"]),
    ("1TH", &["살전"]),
    ("2TH", &["살후"]),
    ("1TI", &["딤전"]),
    ("2TI", &["딤후"]),
    ("TIT", &["딛"]),
    ("PHM", &["몬"]),
    ("1PE", &["벧전"]),
    ("2PE", &["벧후"]),
    ("1JN", &["요일"]),
    ("2JN", &["요이"]),
    ("3JN", &["요삼"]),
];

/// One-syllable abbreviations that are also ordinary words: a full chapter and verse.
const RISKY_ABBREVIATIONS: &[(&str, &[&str])] = &[
    ("DEU", &["신"]),
    ("PSA", &["시"]),
    ("PRO", &["잠"]),
    ("ISA", &["사"]),
    ("LAM", &["애"]),
    ("HOS", &["호"]),
    ("AMO", &["암"]),
    ("MIC", &["미"]),
    ("HAB", &["합"]),
    ("HAG", &["학"]),
    ("MAL", &["말"]),
    ("MAT", &["마"]),
    ("JHN", &["요"]),
    ("ACT", &["행"]),
    ("GAL", &["갈"]),
    ("PHP", &["빌"]),
    ("COL", &["골"]),
    ("HEB", &["히"]),
    ("JUD", &["유"]),
    ("REV", &["계"]),
];

pub fn dictionary() -> AliasDictionary {
    let mut entries = Vec::new();
    for (rows, strictness) in [
        (NAMES, Strictness::Full),
        (SHORT_NAMES, Strictness::Unit),
        (ABBREVIATIONS, Strictness::Unit),
        (RISKY_ABBREVIATIONS, Strictness::Verse),
    ] {
        for (code, aliases) in rows {
            let book = book(code);
            for alias in *aliases {
                entries.push(AliasEntry {
                    alias: (*alias).to_string(),
                    book,
                    strictness,
                });
            }
        }
    }
    AliasDictionary {
        language: ReferenceLanguage::Ko,
        entries,
        syntax: Syntax {
            grammar: Grammar::Korean,
            verse_separator: "",
            number_join: None,
            require_capital: false,
            no_fold: &[],
        },
    }
}
