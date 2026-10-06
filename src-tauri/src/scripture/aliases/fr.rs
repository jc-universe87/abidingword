//! French: Louis Segond and Bible de Jérusalem names and abbreviations.
//! Notation: `Jean 3,16`, `Jn 3,16-18`, `Jn 3:16`, `1 Co 13,4-7`, `I Co 13`.
//!
//! Left out on purpose, because they are ordinary French words or common
//! abbreviations of something else: Os (Osée; "os"), Mi (Michée), Ne/Né
//! (Néhémie; "ne", "né"), Est (Esther; "est"), Es/És (Ésaïe), Je/Jé (Jérémie;
//! "je"), La (Lamentations), Nb (Nombres; "NB"), Jc (Jacques; "J.-C."), Mr
//! (Marc), He/Hé (Hébreux; "Hé!"), and single letters (1 S, 1 R, 1 P).
//! Those books are still found by their full names and their longer abbreviations.

use super::{comma_syntax, latin, Row};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::AliasDictionary;

const ROWS: &[Row] = &[
    ("GEN", &["genèse", "gn"]),
    ("EXO", &["exode", "ex"]),
    ("LEV", &["lévitique", "lv"]),
    ("NUM", &["nombres"]),
    ("DEU", &["deutéronome", "dt"]),
    ("JOS", &["josué", "jos"]),
    ("JDG", &["juges", "jg"]),
    ("RUT", &["ruth", "rt"]),
    ("1SA", &["samuel", "sm"]),
    ("2SA", &["samuel", "sm"]),
    ("1KI", &["rois"]),
    ("2KI", &["rois"]),
    ("1CH", &["chroniques", "ch"]),
    ("2CH", &["chroniques", "ch"]),
    ("EZR", &["esdras", "esd"]),
    ("NEH", &["néhémie"]),
    ("EST", &["esther"]),
    ("JOB", &["job"]),
    ("PSA", &["psaume", "psaumes", "ps"]),
    ("PRO", &["proverbes", "prov", "pr"]),
    ("ECC", &["ecclésiaste", "qohéleth", "qo"]),
    ("SNG", &["cantique des cantiques", "cantique", "cant"]),
    ("ISA", &["ésaïe", "isaïe", "is"]),
    ("JER", &["jérémie", "jr", "jer"]),
    ("LAM", &["lamentations", "lm"]),
    ("EZK", &["ézéchiel", "ez"]),
    ("DAN", &["daniel", "dn"]),
    ("HOS", &["osée"]),
    ("JOL", &["joël", "jl"]),
    ("AMO", &["amos"]),
    ("OBA", &["abdias"]),
    ("JON", &["jonas", "jon"]),
    ("MIC", &["michée"]),
    ("NAM", &["nahum"]),
    ("HAB", &["habacuc", "hab"]),
    ("ZEP", &["sophonie"]),
    ("HAG", &["aggée"]),
    ("ZEC", &["zacharie", "zach"]),
    ("MAL", &["malachie", "mal"]),
    ("MAT", &["matthieu", "mt"]),
    ("MRK", &["marc", "mc"]),
    ("LUK", &["luc", "lc"]),
    ("JHN", &["jean", "jn"]),
    ("ACT", &["actes", "ac"]),
    ("ROM", &["romains", "rm", "ro"]),
    ("1CO", &["corinthiens", "co"]),
    ("2CO", &["corinthiens", "co"]),
    ("GAL", &["galates", "ga"]),
    ("EPH", &["éphésiens", "ép", "eph"]),
    ("PHP", &["philippiens", "ph", "php"]),
    ("COL", &["colossiens", "col"]),
    ("1TH", &["thessaloniciens", "th"]),
    ("2TH", &["thessaloniciens", "th"]),
    ("1TI", &["timothée", "ti", "tm"]),
    ("2TI", &["timothée", "ti", "tm"]),
    ("TIT", &["tite", "tt"]),
    ("PHM", &["philémon", "phm"]),
    ("HEB", &["hébreux", "heb"]),
    ("JAS", &["jacques"]),
    ("1PE", &["pierre", "pi"]),
    ("2PE", &["pierre", "pi"]),
    ("1JN", &["jean", "jn"]),
    ("2JN", &["jean", "jn"]),
    ("3JN", &["jean", "jn"]),
    ("JUD", &["jude"]),
    ("REV", &["apocalypse", "ap"]),
];

pub fn dictionary() -> AliasDictionary {
    latin(ReferenceLanguage::Fr, ROWS, true, comma_syntax(r"\s*", &[]))
}
