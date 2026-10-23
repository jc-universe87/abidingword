//! Morphology codes (v0.21). A Bible's `x-morph` values are kept exactly as
//! written; only codes of a scheme whose documentation has been checked are
//! described in words.
//!
//! **Supported: the Open Scriptures Hebrew Bible (OSHB) morphology codes**
//! for Biblical Hebrew and Aramaic, as documented in
//! `HebrewMorphologyCodes.html` of github.com/openscriptures/morphhb (CC BY
//! 4.0). A code is a language letter (`H` Hebrew, `A` Aramaic) and one part
//! of speech per segment, each followed by its own positional letters:
//!
//! | Part of speech | Letters after it |
//! |---|---|
//! | A adjective | type, gender, number, state |
//! | C conjunction, D adverb | none |
//! | N noun | type, gender, number, state |
//! | P pronoun | type, person, gender, number |
//! | R preposition | type (`d`: with the article) |
//! | S suffix | type, person, gender, number |
//! | T particle | type |
//! | V verb | stem, conjugation type, then person, gender, number — or, for participles, gender, number, state |
//!
//! `x` stands for an unknown or unneeded value. Two spellings are read:
//! OSHB's own (`HR/Ncfsa`: one language letter, segments separated by `/`)
//! and the comma-prefixed form some USFM editions use (`He,R:Ncfsa`: `He,`
//! or `Ar,`, segments separated by `:`). Every letter must be one the table
//! defines, or the code is not described at all.
//!
//! Every other scheme (Greek codes of any publisher among them) is shown as
//! written: its documentation was not available to check, and a wrong
//! expansion would be worse than none.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    Hebrew,
    Aramaic,
}

/// One grammatical property, as keys the interface translates
/// (`scripture.morph.<field>.<value>`); verb stems are names, shown as given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub field: &'static str,
    pub value: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// adjective, conjunction, adverb, noun, pronoun, preposition, suffix, particle, verb
    pub part_of_speech: &'static str,
    pub features: Vec<Feature>,
}

/// A code described from its scheme's documentation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Described {
    pub scheme: &'static str,
    pub language: Language,
    pub segments: Vec<Segment>,
}

pub const OSHB: &str = "oshb";

fn lookup(table: &[(char, &'static str)], c: char) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == c).map(|(_, v)| *v)
}

const PERSON: &[(char, &str)] = &[('1', "first"), ('2', "second"), ('3', "third")];
const GENDER: &[(char, &str)] = &[
    ('b', "both"),
    ('c', "common"),
    ('f', "feminine"),
    ('m', "masculine"),
];
const NUMBER: &[(char, &str)] = &[('d', "dual"), ('p', "plural"), ('s', "singular")];
const STATE: &[(char, &str)] = &[('a', "absolute"), ('c', "construct"), ('d', "determined")];
const ADJECTIVE: &[(char, &str)] = &[
    ('a', "adjective"),
    ('c', "cardinal"),
    ('g', "gentilic"),
    ('o', "ordinal"),
];
const NOUN: &[(char, &str)] = &[('c', "common"), ('g', "gentilic"), ('p', "properName")];
const PRONOUN: &[(char, &str)] = &[
    ('d', "demonstrative"),
    ('f', "indefinite"),
    ('i', "interrogative"),
    ('p', "personal"),
    ('r', "relative"),
];
const PREPOSITION: &[(char, &str)] = &[('d', "definiteArticle")];
const SUFFIX: &[(char, &str)] = &[
    ('d', "directionalHe"),
    ('h', "paragogicHe"),
    ('n', "paragogicNun"),
    ('p', "pronominal"),
];
const PARTICLE: &[(char, &str)] = &[
    ('a', "affirmation"),
    ('d', "definiteArticle"),
    ('e', "exhortation"),
    ('i', "interrogative"),
    ('j', "interjection"),
    ('m', "demonstrative"),
    ('n', "negative"),
    ('o', "directObject"),
    ('r', "relative"),
];
const CONJUGATION: &[(char, &str)] = &[
    ('p', "perfect"),
    ('q', "sequentialPerfect"),
    ('i', "imperfect"),
    ('w', "sequentialImperfect"),
    ('h', "cohortative"),
    ('j', "jussive"),
    ('v', "imperative"),
    ('r', "participleActive"),
    ('s', "participlePassive"),
    ('a', "infinitiveAbsolute"),
    ('c', "infinitiveConstruct"),
];
const HEBREW_STEMS: &[(char, &str)] = &[
    ('q', "qal"),
    ('N', "niphal"),
    ('p', "piel"),
    ('P', "pual"),
    ('h', "hiphil"),
    ('H', "hophal"),
    ('t', "hithpael"),
    ('o', "polel"),
    ('O', "polal"),
    ('r', "hithpolel"),
    ('m', "poel"),
    ('M', "poal"),
    ('k', "palel"),
    ('K', "pulal"),
    ('Q', "qal passive"),
    ('l', "pilpel"),
    ('L', "polpal"),
    ('f', "hithpalpel"),
    ('D', "nithpael"),
    ('j', "pealal"),
    ('i', "pilel"),
    ('u', "hothpaal"),
    ('c', "tiphil"),
    ('v', "hishtaphel"),
    ('w', "nithpalel"),
    ('y', "nithpoel"),
    ('z', "hithpoel"),
];
const ARAMAIC_STEMS: &[(char, &str)] = &[
    ('q', "peal"),
    ('Q', "peil"),
    ('u', "hithpeel"),
    ('p', "pael"),
    ('P', "ithpaal"),
    ('M', "hithpaal"),
    ('a', "aphel"),
    ('h', "haphel"),
    ('s', "saphel"),
    ('e', "shaphel"),
    ('H', "hophal"),
    ('i', "ithpeel"),
    ('t', "hishtaphel"),
    ('v', "ishtaphel"),
    ('w', "hithaphel"),
    ('o', "polel"),
    ('z', "ithpoel"),
    ('r', "hithpolel"),
    ('f', "hithpalpel"),
    ('b', "hephal"),
    ('c', "tiphel"),
    ('m', "poel"),
    ('l', "palpel"),
    ('L', "ithpalpel"),
    ('O', "ithpolel"),
    ('G', "ittaphal"),
];

type Slot = (&'static str, &'static [(char, &'static str)]);

/// Reads the positional letters after a part of speech against its slots;
/// `x` leaves a slot unknown. More letters than slots, or a letter a slot
/// does not define, and the segment is not described.
fn read_slots(letters: &[char], slots: &[Slot]) -> Option<Vec<Feature>> {
    if letters.len() > slots.len() {
        return None;
    }
    let mut out = Vec::new();
    for (c, (field, table)) in letters.iter().zip(slots) {
        if *c == 'x' {
            continue;
        }
        out.push(Feature {
            field,
            value: lookup(table, *c)?,
        });
    }
    Some(out)
}

fn segment(code: &str, language: Language) -> Option<Segment> {
    let chars: Vec<char> = code.chars().collect();
    let (&pos, rest) = chars.split_first()?;
    let (part_of_speech, features) = match pos {
        'A' => (
            "adjective",
            read_slots(
                rest,
                &[
                    ("adjectiveType", ADJECTIVE),
                    ("gender", GENDER),
                    ("number", NUMBER),
                    ("state", STATE),
                ],
            )?,
        ),
        'C' => ("conjunction", read_slots(rest, &[])?),
        'D' => ("adverb", read_slots(rest, &[])?),
        'N' => (
            "noun",
            read_slots(
                rest,
                &[
                    ("nounType", NOUN),
                    ("gender", GENDER),
                    ("number", NUMBER),
                    ("state", STATE),
                ],
            )?,
        ),
        'P' => (
            "pronoun",
            read_slots(
                rest,
                &[
                    ("pronounType", PRONOUN),
                    ("person", PERSON),
                    ("gender", GENDER),
                    ("number", NUMBER),
                ],
            )?,
        ),
        'R' => (
            "preposition",
            read_slots(rest, &[("prepositionType", PREPOSITION)])?,
        ),
        'S' => (
            "suffix",
            read_slots(
                rest,
                &[
                    ("suffixType", SUFFIX),
                    ("person", PERSON),
                    ("gender", GENDER),
                    ("number", NUMBER),
                ],
            )?,
        ),
        'T' => ("particle", read_slots(rest, &[("particleType", PARTICLE)])?),
        'V' => {
            let stems = match language {
                Language::Hebrew => HEBREW_STEMS,
                Language::Aramaic => ARAMAIC_STEMS,
            };
            let (&stem, after) = rest.split_first()?;
            let mut features = vec![Feature {
                field: "stem",
                value: lookup(stems, stem)?,
            }];
            if let Some((&kind, tail)) = after.split_first() {
                let conjugation = lookup(CONJUGATION, kind)?;
                features.push(Feature {
                    field: "conjugation",
                    value: conjugation,
                });
                // Participles take no person but a state; finite forms the reverse.
                let slots: &[Slot] = if matches!(kind, 'r' | 's') {
                    &[("gender", GENDER), ("number", NUMBER), ("state", STATE)]
                } else {
                    &[("person", PERSON), ("gender", GENDER), ("number", NUMBER)]
                };
                features.extend(read_slots(tail, slots)?);
            }
            ("verb", features)
        }
        _ => return None,
    };
    Some(Segment {
        part_of_speech,
        features,
    })
}

/// Describes an OSHB code (either spelling), or `None` when it is not one.
pub fn describe_oshb(code: &str) -> Option<Described> {
    let code = code.trim();
    let (language, segments): (Language, Vec<&str>) = if let Some(rest) = code.strip_prefix("He,") {
        (Language::Hebrew, rest.split(':').collect())
    } else if let Some(rest) = code.strip_prefix("Ar,") {
        (Language::Aramaic, rest.split(':').collect())
    } else {
        let mut chars = code.chars();
        let language = match chars.next()? {
            'H' => Language::Hebrew,
            'A' => Language::Aramaic,
            _ => return None,
        };
        (language, chars.as_str().split('/').collect())
    };
    if segments.is_empty() || segments.iter().any(|s| s.is_empty()) {
        return None;
    }
    let segments = segments
        .into_iter()
        .map(|s| segment(s, language))
        .collect::<Option<Vec<_>>>()?;
    Some(Described {
        scheme: OSHB,
        language,
        segments,
    })
}

/// Describes `code` in `scheme` (only OSHB is described; see the module notes).
pub fn describe(scheme: &str, code: &str) -> Option<Described> {
    (scheme == OSHB).then(|| describe_oshb(code)).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(code: &str) -> Vec<&'static str> {
        describe_oshb(code)
            .unwrap()
            .segments
            .iter()
            .map(|s| s.part_of_speech)
            .collect()
    }

    fn values(code: &str, i: usize) -> Vec<&'static str> {
        describe_oshb(code).unwrap().segments[i]
            .features
            .iter()
            .map(|f| f.value)
            .collect()
    }

    #[test]
    fn the_documented_genesis_examples() {
        // The examples in HebrewMorphologyCodes.html (Genesis 1:1).
        assert_eq!(pos("HR/Ncfsa"), ["preposition", "noun"]);
        assert_eq!(
            values("HR/Ncfsa", 1),
            ["common", "feminine", "singular", "absolute"]
        );
        assert_eq!(pos("HVqp3ms"), ["verb"]);
        assert_eq!(
            values("HVqp3ms", 0),
            ["qal", "perfect", "third", "masculine", "singular"]
        );
        assert_eq!(
            values("HNcmpa", 0),
            ["common", "masculine", "plural", "absolute"]
        );
        assert_eq!(values("HTo", 0), ["directObject"]);
        assert_eq!(pos("HTd/Ncmpa"), ["particle", "noun"]);
        assert_eq!(pos("HC/To"), ["conjunction", "particle"]);
    }

    #[test]
    fn participles_take_a_state_and_no_person() {
        assert_eq!(
            values("HVqrmsa", 0),
            [
                "qal",
                "participleActive",
                "masculine",
                "singular",
                "absolute"
            ]
        );
        // A person letter where a participle has gender: not a code of the scheme.
        assert!(describe_oshb("HVqr3ms").is_none());
        assert_eq!(values("HVqc", 0), ["qal", "infinitiveConstruct"]);
        assert_eq!(
            values("HVqi3xs", 0),
            ["qal", "imperfect", "third", "singular"]
        );
    }

    #[test]
    fn stems_follow_the_language() {
        assert_eq!(values("AVap3ms", 0)[0], "aphel");
        assert!(describe_oshb("HVap3ms").is_none(), "a is not a Hebrew stem");
        assert_eq!(
            describe_oshb("Ar,Vqp3ms").unwrap().language,
            Language::Aramaic
        );
    }

    #[test]
    fn the_comma_spelling_reads_the_same() {
        assert_eq!(
            describe_oshb("He,R:Ncfsa").unwrap().segments,
            describe_oshb("HR/Ncfsa").unwrap().segments
        );
        assert_eq!(pos("He,C:Vqw3ms"), ["conjunction", "verb"]);
    }

    #[test]
    fn anything_else_is_not_described() {
        for code in [
            "",
            "H",
            "HNcmsaz",
            "HZ",
            "Gr,N,,,,,NMS,",
            "V-PAI-3S",
            "N-NSM",
            "HNcmsa/",
            "HCq",
            "He,",
            "HR//Ncfsa",
        ] {
            assert!(describe_oshb(code).is_none(), "{code:?}");
        }
        assert!(
            describe("raw", "HNcmsa").is_none(),
            "only the oshb scheme is described"
        );
    }
}
