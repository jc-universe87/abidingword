//! Greek grammar codes (v0.22), each scheme read only as its own
//! documentation defines it. A code with any letter, part or combination the
//! documentation does not define is not described at all (it is shown as
//! written); nothing is guessed, and the two schemes are never mixed.
//!
//! **Robinson** — "The Online Greek New Testament Declension Codes" (29 July
//! 2004) and "… Parsing Codes for Verb-Related Forms" (27 July 2004) by
//! Maurice A. Robinson, as printed in the front matter of the
//! Robinson–Pierpont 2018 edition (eBible.org `grcmt`):
//!
//! - undeclined: `ADV CONJ COND PRT PREP INJ ARAM HEB N-PRI A-NUI N-LI N-OI`;
//! - declined: `prefix-case-number-gender(-suffix)`, prefixes
//!   `N A R C D T K I X Q F S P`, cases `N V G D A`, numbers `S P`, genders
//!   `M F N`; reflexive (`F`) and personal (`P`) pronouns carry the person;
//!   1st and 2nd person personal pronouns have no gender;
//! - suffixes: `-S` superlative, `-C` comparative, `-ABB` abbreviated, `-I`
//!   interrogative, `-N` negative, `-K` merged by crasis, `-ATT` Attic;
//! - verbs: `V-tense voice mood`, then `-person number` or, for
//!   participles, `-case number gender`; tenses `P I F A R L` (second forms
//!   `2F 2A 2R 2L`), voices `A M P E D O N`, moods `I S O M N P`.
//!
//! Not described: possessive pronouns written with a second letter after the
//! person (`S-1SASF`) — the documentation names the person only — and
//! "2P", which its special note uses for the second perfect while its table
//! (and the text) use `2R`.
//!
//! **MorphGNT** — the README of github.com/morphgnt/sblgnt (version 6.12):
//! a part of speech (`A- C- D- I- N- P- RA RD RI RP RR V- X-`) and an
//! eight-letter parsing: person `1 2 3`, tense `P I F A X Y`, voice `A M P`,
//! mood `I D S O N P`, case `N G D A`, number `S P`, gender `M F N`, degree
//! `C S`, each `-` when not given. The code is stored as written in the
//! file: part of speech, a space, the parsing (`V- 3PAI-S--`). The data also
//! use a case `V` the README does not list: those codes are not described.

use super::morphology::{Described, Feature, Language, Segment, MORPHGNT, ROBINSON};

fn feature(field: &'static str, value: &'static str) -> Feature {
    Feature { field, value }
}

fn pick(table: &[(char, &'static str)], c: char) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == c).map(|(_, v)| *v)
}

const CASE: &[(char, &str)] = &[
    ('N', "nominative"),
    ('V', "vocative"),
    ('G', "genitive"),
    ('D', "dative"),
    ('A', "accusative"),
];
const NUMBER: &[(char, &str)] = &[('S', "singular"), ('P', "plural")];
const GENDER: &[(char, &str)] = &[('M', "masculine"), ('F', "feminine"), ('N', "neuter")];
const PERSON: &[(char, &str)] = &[('1', "first"), ('2', "second"), ('3', "third")];

fn greek(segment: Segment) -> Described {
    Described {
        scheme: ROBINSON,
        language: Language::Greek,
        segments: vec![segment],
    }
}

/// `-S`, `-C`… after a form.
fn robinson_suffix(suffix: &str) -> Option<Feature> {
    Some(match suffix {
        "S" => feature("degree", "superlative"),
        "C" => feature("degree", "comparative"),
        "ABB" => feature("suffix", "abbreviated"),
        "I" => feature("suffix", "interrogative"),
        "N" => feature("suffix", "negative"),
        "K" => feature("suffix", "crasis"),
        "ATT" => feature("suffix", "attic"),
        _ => return None,
    })
}

/// Case, number and gender letters ("NSM").
fn case_number_gender(letters: &str) -> Option<Vec<Feature>> {
    let mut chars = letters.chars();
    let (c, n, g) = (chars.next()?, chars.next()?, chars.next()?);
    if chars.next().is_some() {
        return None;
    }
    Some(vec![
        feature("case", pick(CASE, c)?),
        feature("number", pick(NUMBER, n)?),
        feature("gender", pick(GENDER, g)?),
    ])
}

fn robinson_verb(parts: &[&str]) -> Option<Segment> {
    let (first, tail) = parts.split_first()?;
    let mut chars: Vec<char> = first.chars().collect();
    let mut features = Vec::new();
    let second = chars.first() == Some(&'2');
    if second {
        chars.remove(0);
    }
    let [t, v, m] = chars[..] else { return None };
    let tense = match t {
        'P' => "present",
        'I' => "imperfect",
        'F' => "future",
        'A' => "aorist",
        'R' => "perfect",
        'L' => "pluperfect",
        _ => return None,
    };
    if second && !matches!(t, 'F' | 'A' | 'R' | 'L') {
        return None;
    }
    let voice = match v {
        'A' => "active",
        'M' => "middle",
        'P' => "passive",
        'E' => "middleOrPassive",
        'D' => "middleDeponent",
        'O' => "passiveDeponent",
        'N' => "middleOrPassiveDeponent",
        _ => return None,
    };
    let mood = match m {
        'I' => "indicative",
        'S' => "subjunctive",
        'O' => "optative",
        'M' => "imperative",
        'N' => "infinitive",
        'P' => "participle",
        _ => return None,
    };
    features.push(feature("tense", tense));
    if second {
        features.push(feature("form", "second"));
    }
    features.push(feature("voice", voice));
    features.push(feature("mood", mood));
    let (tail, attic) = match tail {
        [rest @ .., "ATT"] => (rest, true),
        _ => (tail, false),
    };
    match (m, tail) {
        ('N', []) => {}
        ('P', [cng]) => features.extend(case_number_gender(cng)?),
        ('I' | 'S' | 'O' | 'M', [pn]) => {
            let mut c = pn.chars();
            let (p, n) = (c.next()?, c.next()?);
            if c.next().is_some() {
                return None;
            }
            features.push(feature("person", pick(PERSON, p)?));
            features.push(feature("number", pick(NUMBER, n)?));
        }
        _ => return None,
    }
    if attic {
        features.push(feature("suffix", "attic"));
    }
    Some(Segment {
        part_of_speech: "verb",
        features,
    })
}

/// Describes a Robinson code, or `None` when it is not one as documented.
pub fn describe_robinson(code: &str) -> Option<Described> {
    let code = code.trim();
    if code.is_empty() || code.len() > 20 || !code.is_ascii() {
        return None;
    }
    let parts: Vec<&str> = code.split('-').collect();
    if parts.iter().any(|p| p.is_empty()) {
        return None;
    }
    // Undeclined forms, each as a whole, with at most one suffix.
    let undeclined = |head: &str| -> Option<(&'static str, Vec<Feature>)> {
        Some(match head {
            "ADV" => ("adverb", vec![]),
            "CONJ" => ("conjunction", vec![]),
            "COND" => ("conditional", vec![]),
            "PRT" => ("particle", vec![]),
            "PREP" => ("preposition", vec![]),
            "INJ" => ("interjection", vec![]),
            "ARAM" => (
                "transliterated",
                vec![feature("transliteration", "aramaic")],
            ),
            "HEB" => ("transliterated", vec![feature("transliteration", "hebrew")]),
            _ => return None,
        })
    };
    if let Some((pos, mut features)) = undeclined(parts[0]) {
        match &parts[1..] {
            [] => {}
            [suffix] => features.push(robinson_suffix(suffix)?),
            _ => return None,
        }
        return Some(greek(Segment {
            part_of_speech: pos,
            features,
        }));
    }
    let indeclinable = |pos: &'static str, kind: Option<Feature>| {
        let mut features: Vec<Feature> = kind.into_iter().collect();
        features.push(feature("declension", "indeclinable"));
        Some(greek(Segment {
            part_of_speech: pos,
            features,
        }))
    };
    match code {
        "N-PRI" => return indeclinable("noun", Some(feature("nounType", "properName"))),
        "A-NUI" => return indeclinable("adjective", Some(feature("adjectiveType", "numeral"))),
        "N-LI" => return indeclinable("noun", Some(feature("nounType", "letter"))),
        "N-OI" => return indeclinable("noun", None),
        _ => {}
    }
    if parts[0] == "V" {
        return robinson_verb(&parts[1..]).map(greek);
    }
    let pos = match parts[0] {
        "N" => "noun",
        "A" => "adjective",
        "R" => "relativePronoun",
        "C" => "reciprocalPronoun",
        "D" => "demonstrativePronoun",
        "T" => "article",
        "K" => "correlativePronoun",
        "I" => "interrogativePronoun",
        "X" => "indefinitePronoun",
        "Q" => "correlativeOrInterrogativePronoun",
        "F" => "reflexivePronoun",
        "S" => "possessivePronoun",
        "P" => "personalPronoun",
        _ => return None,
    };
    let (body, suffix) = match &parts[1..] {
        [body] => (*body, None),
        [body, suffix] => (*body, Some(robinson_suffix(suffix)?)),
        _ => return None,
    };
    let mut features = Vec::new();
    let mut letters = body;
    let person = body.chars().next().and_then(|c| pick(PERSON, c));
    match (parts[0], person) {
        // Reflexive and possessive pronouns always state the person.
        ("F", Some(p)) => {
            features.push(feature("person", p));
            letters = &body[1..];
        }
        ("F" | "S", _) => return None,
        ("P", Some(p)) => {
            features.push(feature("person", p));
            letters = &body[1..];
            // 1st and 2nd person: case and number, never a gender.
            if p != "third" && letters.len() != 2 {
                return None;
            }
            if letters.len() == 2 {
                let mut c = letters.chars();
                let (k, n) = (c.next()?, c.next()?);
                features.push(feature("case", pick(CASE, k)?));
                features.push(feature("number", pick(NUMBER, n)?));
                features.extend(suffix);
                return Some(greek(Segment {
                    part_of_speech: pos,
                    features,
                }));
            }
        }
        (_, Some(_)) => return None,
        _ => {}
    }
    features.extend(case_number_gender(letters)?);
    features.extend(suffix);
    Some(greek(Segment {
        part_of_speech: pos,
        features,
    }))
}

/// Describes a MorphGNT code ("V- 3PAI-S--"), or `None`.
pub fn describe_morphgnt(code: &str) -> Option<Described> {
    let (pos, parsing) = code.split_once(' ')?;
    let part_of_speech = match pos {
        "A-" => "adjective",
        "C-" => "conjunction",
        "D-" => "adverb",
        "I-" => "interjection",
        "N-" => "noun",
        "P-" => "preposition",
        "RA" => "article",
        "RD" => "demonstrativePronoun",
        "RI" => "interrogativeOrIndefinitePronoun",
        "RP" => "personalPronoun",
        "RR" => "relativePronoun",
        "V-" => "verb",
        "X-" => "particle",
        _ => return None,
    };
    let letters: Vec<char> = parsing.chars().collect();
    if letters.len() != 8 {
        return None;
    }
    type Slot = (&'static str, &'static [(char, &'static str)]);
    const SLOTS: [Slot; 8] = [
        ("person", PERSON),
        (
            "tense",
            &[
                ('P', "present"),
                ('I', "imperfect"),
                ('F', "future"),
                ('A', "aorist"),
                ('X', "perfect"),
                ('Y', "pluperfect"),
            ],
        ),
        (
            "voice",
            &[('A', "active"), ('M', "middle"), ('P', "passive")],
        ),
        (
            "mood",
            &[
                ('I', "indicative"),
                ('D', "imperative"),
                ('S', "subjunctive"),
                ('O', "optative"),
                ('N', "infinitive"),
                ('P', "participle"),
            ],
        ),
        // The README lists four cases; a vocative in the data is not described.
        (
            "case",
            &[
                ('N', "nominative"),
                ('G', "genitive"),
                ('D', "dative"),
                ('A', "accusative"),
            ],
        ),
        ("number", NUMBER),
        ("gender", GENDER),
        ("degree", &[('C', "comparative"), ('S', "superlative")]),
    ];
    let mut features = Vec::new();
    for (c, (field, table)) in letters.iter().zip(SLOTS) {
        if *c == '-' {
            continue;
        }
        features.push(feature(field, pick(table, *c)?));
    }
    Some(Described {
        scheme: MORPHGNT,
        language: Language::Greek,
        segments: vec![Segment {
            part_of_speech,
            features,
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(d: Option<Described>) -> Vec<&'static str> {
        let d = d.expect("described");
        let s = &d.segments[0];
        std::iter::once(s.part_of_speech)
            .chain(s.features.iter().map(|f| f.value))
            .collect()
    }

    #[test]
    fn robinson_examples_from_its_documentation() {
        // Each form the documentation names, read as it defines it.
        assert_eq!(
            values(describe_robinson("V-IAI-3S")),
            [
                "verb",
                "imperfect",
                "active",
                "indicative",
                "third",
                "singular"
            ]
        );
        assert_eq!(
            values(describe_robinson("V-2AAP-NSM")),
            [
                "verb",
                "aorist",
                "second",
                "active",
                "participle",
                "nominative",
                "singular",
                "masculine"
            ]
        );
        assert_eq!(
            values(describe_robinson("V-PAN")),
            ["verb", "present", "active", "infinitive"]
        );
        assert_eq!(
            values(describe_robinson("N-DSF")),
            ["noun", "dative", "singular", "feminine"]
        );
        assert_eq!(
            values(describe_robinson("T-NSM")),
            ["article", "nominative", "singular", "masculine"]
        );
        assert_eq!(
            values(describe_robinson("F-3DSF")),
            [
                "reflexivePronoun",
                "third",
                "dative",
                "singular",
                "feminine"
            ]
        );
        assert_eq!(
            values(describe_robinson("P-1NS")),
            ["personalPronoun", "first", "nominative", "singular"]
        );
        assert_eq!(
            values(describe_robinson("P-GSM")),
            ["personalPronoun", "genitive", "singular", "masculine"]
        );
        assert_eq!(
            values(describe_robinson("A-APN-C")),
            ["adjective", "accusative", "plural", "neuter", "comparative"]
        );
        assert_eq!(values(describe_robinson("CONJ")), ["conjunction"]);
        assert_eq!(
            values(describe_robinson("ADV-I")),
            ["adverb", "interrogative"]
        );
        assert_eq!(
            values(describe_robinson("N-PRI")),
            ["noun", "properName", "indeclinable"]
        );
        assert_eq!(
            values(describe_robinson("HEB")),
            ["transliterated", "hebrew"]
        );
    }

    #[test]
    fn robinson_refuses_what_it_does_not_define() {
        for code in [
            "",
            "V",
            "V-PAI",
            "V-PAP-3S",
            "V-PAI-NSM",
            "V-2PAI-3S",
            "V-XAI-3S",
            "N-NSX",
            "N-NS",
            "S-1SASF",
            "F-DSF",
            "P-1NSM",
            "A-NSM-Z",
            "N-NSM-C-S",
            "HR/Ncfsa",
            "V- 3PAI-S--",
            "PREP-X",
            "n-nsm",
        ] {
            assert!(describe_robinson(code).is_none(), "{code:?}");
        }
    }

    #[test]
    fn morphgnt_codes_as_its_readme_defines_them() {
        assert_eq!(
            values(describe_morphgnt("V- 3IAI-S--")),
            [
                "verb",
                "third",
                "imperfect",
                "active",
                "indicative",
                "singular"
            ]
        );
        assert_eq!(
            values(describe_morphgnt("N- ----DSF-")),
            ["noun", "dative", "singular", "feminine"]
        );
        assert_eq!(
            values(describe_morphgnt("RA ----NSM-")),
            ["article", "nominative", "singular", "masculine"]
        );
        assert_eq!(values(describe_morphgnt("P- --------")), ["preposition"]);
        assert_eq!(
            values(describe_morphgnt("A- ----NSMC")),
            [
                "adjective",
                "nominative",
                "singular",
                "masculine",
                "comparative"
            ]
        );
        // The vocative is used in the data but not documented: not described.
        assert!(describe_morphgnt("N- ----VSM-").is_none());
        for code in [
            "V- 3IAI-S-",
            "V-3IAI-S--",
            "Q- ----NSM-",
            "V- 3ZAI-S--",
            "N-NSM",
        ] {
            assert!(describe_morphgnt(code).is_none(), "{code:?}");
        }
    }
}
