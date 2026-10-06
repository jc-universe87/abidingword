//! Spanish: Reina-Valera and Nueva Versión Internacional names and abbreviations.
//! Notation: `Juan 3:16`, `Juan 3,16`, `1 Corintios 13:4-7`, `1 Co 13`, `I Co 13`.
//!
//! "Amós" counts only with its accent: "amos" is a common word.
//!
//! Left out on purpose, because they are ordinary Spanish words or common
//! abbreviations of something else: Jue (Jueces; "jue" for jueves), Jc (Jueces;
//! "Jesucristo"), Os (Oseas; "os"), Mal (Malaquías; "mal"), Mr (Marcos), Ap
//! (Apocalipsis; "apartamento"), and single letters (1 S, 1 R, 1 P). Those books
//! are still found by their full names and their longer abbreviations.

use super::{comma_syntax, latin, Row};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::AliasDictionary;

const ROWS: &[Row] = &[
    ("GEN", &["génesis", "gn", "gen"]),
    ("EXO", &["éxodo", "ex"]),
    ("LEV", &["levítico", "lv", "lev"]),
    ("NUM", &["números", "nm", "num"]),
    ("DEU", &["deuteronomio", "dt", "deut"]),
    ("JOS", &["josué", "jos"]),
    ("JDG", &["jueces"]),
    ("RUT", &["rut"]),
    ("1SA", &["samuel", "sam"]),
    ("2SA", &["samuel", "sam"]),
    ("1KI", &["reyes"]),
    ("2KI", &["reyes"]),
    ("1CH", &["crónicas", "cr"]),
    ("2CH", &["crónicas", "cr"]),
    ("EZR", &["esdras", "esd"]),
    ("NEH", &["nehemías", "neh"]),
    ("EST", &["ester", "est"]),
    ("JOB", &["job"]),
    ("PSA", &["salmos", "salmo", "sal"]),
    ("PRO", &["proverbios", "prov", "pr"]),
    ("ECC", &["eclesiastés", "ec", "ecl"]),
    (
        "SNG",
        &["cantar de los cantares", "cantares", "cnt", "cant"],
    ),
    ("ISA", &["isaías", "is"]),
    ("JER", &["jeremías", "jer"]),
    ("LAM", &["lamentaciones", "lm"]),
    ("EZK", &["ezequiel", "ez"]),
    ("DAN", &["daniel", "dn"]),
    ("HOS", &["oseas"]),
    ("JOL", &["joel", "jl"]),
    ("AMO", &["amós", "am"]),
    ("OBA", &["abdías", "abd"]),
    ("JON", &["jonás", "jon"]),
    ("MIC", &["miqueas", "miq"]),
    ("NAM", &["nahúm", "nah"]),
    ("HAB", &["habacuc", "hab"]),
    ("ZEP", &["sofonías", "sof"]),
    ("HAG", &["hageo", "hag"]),
    ("ZEC", &["zacarías", "zac"]),
    ("MAL", &["malaquías"]),
    ("MAT", &["mateo", "mt"]),
    ("MRK", &["marcos", "mc"]),
    ("LUK", &["lucas", "lc"]),
    ("JHN", &["juan", "jn"]),
    ("ACT", &["hechos", "hch"]),
    ("ROM", &["romanos", "ro", "rom"]),
    ("1CO", &["corintios", "co", "cor"]),
    ("2CO", &["corintios", "co", "cor"]),
    ("GAL", &["gálatas", "gal"]),
    ("EPH", &["efesios", "ef"]),
    ("PHP", &["filipenses", "fil"]),
    ("COL", &["colosenses", "col"]),
    ("1TH", &["tesalonicenses", "ts", "tes"]),
    ("2TH", &["tesalonicenses", "ts", "tes"]),
    ("1TI", &["timoteo", "ti", "tim"]),
    ("2TI", &["timoteo", "ti", "tim"]),
    ("TIT", &["tito", "tit"]),
    ("PHM", &["filemón", "flm"]),
    ("HEB", &["hebreos", "heb"]),
    ("JAS", &["santiago", "stg"]),
    ("1PE", &["pedro", "pe", "ped"]),
    ("2PE", &["pedro", "pe", "ped"]),
    ("1JN", &["juan", "jn"]),
    ("2JN", &["juan", "jn"]),
    ("3JN", &["juan", "jn"]),
    ("JUD", &["judas", "jud"]),
    ("REV", &["apocalipsis", "apoc"]),
];

pub fn dictionary() -> AliasDictionary {
    latin(
        ReferenceLanguage::Es,
        ROWS,
        true,
        comma_syntax(r"\s*", &["amós"]),
    )
}
