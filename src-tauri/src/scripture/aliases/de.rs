//! German: Luther and Einheitsübersetzung names, Loccumer/ÖSB abbreviations.
//! Notation: `Joh 3,16`, `Joh 3,16–18`, `Röm 8,1-4`, `1. Kor 13`, `1Kor 13,4`;
//! `Joh 3:16` is accepted too.
//!
//! Left out on purpose, because they are ordinary German words or too likely to
//! be read as one: Am (Amos; "Am 3. Mai"), Mi (Micha; Mittwoch), Hi (Hiob),
//! Mal (Maleachi; "Mal 5 Minuten"). The books are still found by their full names.
//! Only the umlaut spelling "Röm" counts for Römer: "Rom" is the city.
//! Roman numerals ("I Kor") are not used for numbered books: German writes 1., 2., 3.

use super::{comma_syntax, latin, Row};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::AliasDictionary;

const ROWS: &[Row] = &[
    ("GEN", &["genesis", "gen", "1 mose", "1 mo"]),
    ("EXO", &["exodus", "ex", "2 mose", "2 mo"]),
    ("LEV", &["levitikus", "lev", "3 mose", "3 mo"]),
    ("NUM", &["numeri", "num", "4 mose", "4 mo"]),
    ("DEU", &["deuteronomium", "dtn", "5 mose", "5 mo"]),
    ("JOS", &["josua", "jos"]),
    ("JDG", &["richter", "ri"]),
    ("RUT", &["rut"]),
    ("1SA", &["samuel", "sam"]),
    ("2SA", &["samuel", "sam"]),
    ("1KI", &["könige", "kön"]),
    ("2KI", &["könige", "kön"]),
    ("1CH", &["chronik", "chr"]),
    ("2CH", &["chronik", "chr"]),
    ("EZR", &["esra"]),
    ("NEH", &["nehemia", "neh"]),
    ("EST", &["ester", "est"]),
    ("JOB", &["hiob", "ijob"]),
    ("PSA", &["psalm", "psalmen", "ps"]),
    ("PRO", &["sprüche", "sprichwörter", "spr"]),
    ("ECC", &["prediger", "kohelet", "pred", "koh"]),
    ("SNG", &["hoheslied", "hohelied", "hld"]),
    ("ISA", &["jesaja", "jes"]),
    ("JER", &["jeremia", "jer"]),
    ("LAM", &["klagelieder", "klgl"]),
    ("EZK", &["hesekiel", "ezechiel", "hes", "ez"]),
    ("DAN", &["daniel", "dan"]),
    ("HOS", &["hosea", "hos"]),
    ("JOL", &["joel", "joël"]),
    ("AMO", &["amos"]),
    ("OBA", &["obadja", "obd"]),
    ("JON", &["jona", "jon"]),
    ("MIC", &["micha"]),
    ("NAM", &["nahum", "nah"]),
    ("HAB", &["habakuk", "hab"]),
    ("ZEP", &["zefanja", "zephanja", "zef"]),
    ("HAG", &["haggai", "hag"]),
    ("ZEC", &["sacharja", "sach"]),
    ("MAL", &["maleachi"]),
    ("MAT", &["matthäus", "mt"]),
    ("MRK", &["markus", "mk"]),
    ("LUK", &["lukas", "lk"]),
    ("JHN", &["johannes", "joh"]),
    ("ACT", &["apostelgeschichte", "apg"]),
    ("ROM", &["römer", "röm"]),
    ("1CO", &["korinther", "kor"]),
    ("2CO", &["korinther", "kor"]),
    ("GAL", &["galater", "gal"]),
    ("EPH", &["epheser", "eph"]),
    ("PHP", &["philipper", "phil"]),
    ("COL", &["kolosser", "kol"]),
    ("1TH", &["thessalonicher", "thess"]),
    ("2TH", &["thessalonicher", "thess"]),
    ("1TI", &["timotheus", "tim"]),
    ("2TI", &["timotheus", "tim"]),
    ("TIT", &["titus", "tit"]),
    ("PHM", &["philemon", "phlm"]),
    ("HEB", &["hebräer", "hebr"]),
    ("JAS", &["jakobus", "jak"]),
    ("1PE", &["petrus", "petr"]),
    ("2PE", &["petrus", "petr"]),
    ("1JN", &["johannes", "joh"]),
    ("2JN", &["johannes", "joh"]),
    ("3JN", &["johannes", "joh"]),
    ("JUD", &["judas", "jud"]),
    ("REV", &["offenbarung", "offb"]),
];

pub fn dictionary() -> AliasDictionary {
    // "1. Kor", "1.Kor", "1 Kor", "1Kor"
    latin(
        ReferenceLanguage::De,
        ROWS,
        false,
        comma_syntax(r"\.?\s*", &["röm"]),
    )
}
