//! Portuguese: Almeida and Nova Versão Internacional names and abbreviations.
//! Notation: `João 3:16`, `João 3,16`, `1 Coríntios 13:4-7`, `1º Coríntios 13`,
//! `1Co 13`, `I Co 13`.
//!
//! "Amós" counts only with its accent: "amos" is a common word.
//!
//! Left out on purpose, because they are ordinary Portuguese words or common
//! abbreviations of something else: Os (Oseias; "os 3 homens"), Na (Naum; "na"),
//! Ne (Neemias), Ap (Apocalipse; "apartamento"), and single letters (1 S, 1 R).
//! Those books are still found by their full names and their longer abbreviations.
//! "Jó" (Job) and "Jo" (João) differ only by an accent: "Jó" is read only with
//! its accent.

use super::{comma_syntax, latin, Row};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::AliasDictionary;

const ROWS: &[Row] = &[
    ("GEN", &["gênesis", "gn"]),
    ("EXO", &["êxodo", "ex"]),
    ("LEV", &["levítico", "lv"]),
    ("NUM", &["números", "nm"]),
    ("DEU", &["deuteronômio", "dt"]),
    ("JOS", &["josué", "js", "jos"]),
    ("JDG", &["juízes", "jz"]),
    ("RUT", &["rute", "rt"]),
    ("1SA", &["samuel", "sm"]),
    ("2SA", &["samuel", "sm"]),
    ("1KI", &["reis", "rs"]),
    ("2KI", &["reis", "rs"]),
    ("1CH", &["crônicas", "cr"]),
    ("2CH", &["crônicas", "cr"]),
    ("EZR", &["esdras", "esd"]),
    ("NEH", &["neemias"]),
    ("EST", &["ester", "est"]),
    ("JOB", &["jó"]),
    ("PSA", &["salmos", "salmo", "sl"]),
    ("PRO", &["provérbios", "pv", "prov"]),
    ("ECC", &["eclesiastes", "ec"]),
    (
        "SNG",
        &[
            "cântico dos cânticos",
            "cantares de salomão",
            "cantares",
            "ct",
        ],
    ),
    ("ISA", &["isaías", "is"]),
    ("JER", &["jeremias", "jr"]),
    ("LAM", &["lamentações", "lm"]),
    ("EZK", &["ezequiel", "ez"]),
    ("DAN", &["daniel", "dn"]),
    ("HOS", &["oseias"]),
    ("JOL", &["joel", "jl"]),
    ("AMO", &["amós", "am"]),
    ("OBA", &["obadias", "ob"]),
    ("JON", &["jonas", "jn"]),
    ("MIC", &["miqueias", "mq"]),
    ("NAM", &["naum"]),
    ("HAB", &["habacuque", "hc"]),
    ("ZEP", &["sofonias", "sf"]),
    ("HAG", &["ageu", "ag"]),
    ("ZEC", &["zacarias", "zc"]),
    ("MAL", &["malaquias", "ml"]),
    ("MAT", &["mateus", "mt"]),
    ("MRK", &["marcos", "mc"]),
    ("LUK", &["lucas", "lc"]),
    ("JHN", &["joão", "jo"]),
    ("ACT", &["atos", "at"]),
    ("ROM", &["romanos", "rm"]),
    ("1CO", &["coríntios", "co"]),
    ("2CO", &["coríntios", "co"]),
    ("GAL", &["gálatas", "gl"]),
    ("EPH", &["efésios", "ef"]),
    ("PHP", &["filipenses", "fp"]),
    ("COL", &["colossenses", "cl"]),
    ("1TH", &["tessalonicenses", "ts"]),
    ("2TH", &["tessalonicenses", "ts"]),
    ("1TI", &["timóteo", "tm"]),
    ("2TI", &["timóteo", "tm"]),
    ("TIT", &["tito", "tt"]),
    ("PHM", &["filemom", "fm"]),
    ("HEB", &["hebreus", "hb"]),
    ("JAS", &["tiago", "tg"]),
    ("1PE", &["pedro", "pe"]),
    ("2PE", &["pedro", "pe"]),
    ("1JN", &["joão", "jo"]),
    ("2JN", &["joão", "jo"]),
    ("3JN", &["joão", "jo"]),
    ("JUD", &["judas", "jd"]),
    ("REV", &["apocalipse", "apoc"]),
];

pub fn dictionary() -> AliasDictionary {
    // "1 Co", "1Co", "1º Coríntios"
    latin(
        ReferenceLanguage::Pt,
        ROWS,
        true,
        comma_syntax(r"[º°]?\s*", &["amós"]),
    )
}
