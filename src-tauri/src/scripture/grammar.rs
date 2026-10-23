//! Which grammar-code scheme a Bible's codes are in, and on what grounds
//! (v0.22). Two separate questions:
//!
//! 1. **Fit** — do the codes decode with a documented scheme? At least 95% of
//!    the coded words must (a few codes a scheme leaves undefined stay raw).
//!    A fit is a check, never proof: a code shaped like OSHB is not
//!    evidence that the publisher used OSHB.
//! 2. **Provenance** — does the edition itself say so? Either its own format
//!    (an OSHB OSIS file names its work `OSHB`; a MorphGNT file is MorphGNT's
//!    own format), or a statement in the files that came with it (a
//!    `copr.htm`, README or front matter naming the scheme's source).
//!
//! Codes are described only with provenance (`basis: edition`) or when the
//! person chooses the fitting scheme at import (`basis: person`). Otherwise
//! they are shown as written. Nothing is carried from one edition to another.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::morphology::{self, MORPHGNT, OSHB, ROBINSON, SCHEMES};

/// The least share of coded words that must decode for a scheme to fit.
const FIT_PERCENT: usize = 95;

/// Where an edition names its scheme.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    /// The file it is in ("copr.htm", "00-FRTgrcmt.usfm", "Gen.xml").
    pub file: String,
    /// The words found, exactly ("Open Scriptures Hebrew Bible").
    pub words: String,
}

/// What the import found about the Bible's grammar codes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarFinding {
    /// The documented scheme the codes fit, if any.
    pub scheme: Option<&'static str>,
    /// Coded words, and how many of them the scheme describes.
    pub coded: usize,
    pub described: usize,
    /// The edition's own statement of that scheme, when there is one.
    pub stated: Option<Statement>,
}

/// The words that name each scheme's source in an edition's own files.
fn names(scheme: &str) -> &'static [&'static [&'static str]] {
    match scheme {
        // Every phrase of one alternative must be present.
        OSHB => &[&["Open Scriptures Hebrew Bible"]],
        ROBINSON => &[&["Maurice A. Robinson", "PARSING CODES"]],
        MORPHGNT => &[&["MorphGNT"]],
        _ => &[],
    }
}

/// The first statement of `scheme` in the notes (name, text).
pub fn find_statement(scheme: &str, notes: &[(String, String)]) -> Option<Statement> {
    for (file, text) in notes {
        for phrases in names(scheme) {
            if phrases.iter().all(|p| text.contains(p)) {
                return Some(Statement {
                    file: file.clone(),
                    words: phrases.join(" … "),
                });
            }
        }
    }
    None
}

/// The finding for a Bible's codes (code → words), with the edition's own
/// statement if any. `declared` is a statement made by the format itself.
pub fn identify(
    codes: &HashMap<String, usize>,
    notes: &[(String, String)],
    declared: Option<(&'static str, Statement)>,
) -> GrammarFinding {
    let coded: usize = codes.values().sum();
    if coded == 0 {
        return GrammarFinding::default();
    }
    let best = SCHEMES
        .iter()
        .map(|scheme| {
            let described: usize = codes
                .iter()
                .filter(|(code, _)| morphology::describe(scheme, code).is_some())
                .map(|(_, n)| n)
                .sum();
            (*scheme, described)
        })
        .max_by_key(|(_, n)| *n)
        .filter(|(_, n)| n * 100 >= coded * FIT_PERCENT);
    let Some((scheme, described)) = best else {
        return GrammarFinding {
            coded,
            ..Default::default()
        };
    };
    let stated = match declared {
        Some((named, statement)) if named == scheme => Some(statement),
        // The format names another scheme than the codes are in: no statement.
        Some(_) => None,
        None => find_statement(scheme, notes),
    };
    GrammarFinding {
        scheme: Some(scheme),
        coded,
        described,
        stated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(list: &[(&str, usize)]) -> HashMap<String, usize> {
        list.iter().map(|(c, n)| (c.to_string(), *n)).collect()
    }

    #[test]
    fn a_fit_without_a_statement_is_only_a_fit() {
        let found = identify(&codes(&[("HVqp3ms", 10), ("HNcmpa", 20)]), &[], None);
        assert_eq!(found.scheme, Some(OSHB));
        assert_eq!((found.coded, found.described), (30, 30));
        assert!(found.stated.is_none());
    }

    #[test]
    fn the_editions_own_words_are_the_statement() {
        let notes = vec![(
            "copr.htm".to_string(),
            "Lemma and morphology data … credit the Open Scriptures Hebrew Bible Project."
                .to_string(),
        )];
        let found = identify(&codes(&[("HVqp3ms", 10)]), &notes, None);
        assert_eq!(found.stated.unwrap().file, "copr.htm");
        // Naming one scheme says nothing about codes of another.
        let robinson = identify(&codes(&[("V-PAI-3S", 10)]), &notes, None);
        assert_eq!(robinson.scheme, Some(ROBINSON));
        assert!(robinson.stated.is_none());
        // Robinson's documentation names both its author and its subject.
        let frt = vec![(
            "00-FRT.usfm".to_string(),
            "PARSING CODES FOR VERB-RELATED FORMS … Maurice A. Robinson".to_string(),
        )];
        assert!(identify(&codes(&[("V-PAI-3S", 10)]), &frt, None)
            .stated
            .is_some());
        let partial = vec![("x".to_string(), "Maurice A. Robinson".to_string())];
        assert!(identify(&codes(&[("V-PAI-3S", 10)]), &partial, None)
            .stated
            .is_none());
    }

    #[test]
    fn too_few_codes_that_decode_is_no_fit() {
        let found = identify(&codes(&[("HVqp3ms", 90), ("ZZZ", 10)]), &[], None);
        assert!(found.scheme.is_none());
        assert_eq!(found.coded, 100);
        let found = identify(&codes(&[("HVqp3ms", 96), ("ZZZ", 4)]), &[], None);
        assert_eq!(found.scheme, Some(OSHB));
    }

    #[test]
    fn a_format_declaring_another_scheme_states_nothing() {
        let s = Statement {
            file: "f".into(),
            words: "w".into(),
        };
        let found = identify(&codes(&[("V-PAI-3S", 10)]), &[], Some((OSHB, s)));
        assert_eq!(found.scheme, Some(ROBINSON));
        assert!(found.stated.is_none());
    }
}
