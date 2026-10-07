//! The passage index of one source: every Scripture reference found in its
//! text and every section link derived from its headings, **for one language**.
//!
//! This is the only place that runs reference detection over a source. The
//! import preview, the import commit and the rebuild of an existing library all
//! call [`build`], so they cannot disagree.
//!
//! The language is the *source's* (`sources.language`, as the person confirmed
//! it), never the interface language and never guessed from the text. The
//! preview uses what the file's metadata says (or English); the commit uses
//! the language finally chosen, so a person who corrects the language before
//! adding a source gets links for the corrected language. A source with no
//! recognised language is read with English (the long-standing behaviour) and
//! the fact is logged; dictionaries are never merged.

use crate::library::sections::{self, DerivedLink};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::{DetectedReference, ReferenceParser};

/// The references and section links of a source, in one language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassageIndex {
    pub language: ReferenceLanguage,
    /// References written in a segment's own text, by segment index.
    pub references: Vec<(usize, DetectedReference)>,
    /// Section and inherited links derived from the headings (EPUB, Word,
    /// Markdown); empty for formats without structure.
    pub sections: Vec<DerivedLink>,
}

/// Builds the index of a source of this `format` from its segments, each given
/// as (text, section path), in reading order.
pub fn build<'a, I>(format: &str, segments: I, language: ReferenceLanguage) -> PassageIndex
where
    I: IntoIterator<Item = (&'a str, Option<&'a str>)> + Clone,
{
    let parser = ReferenceParser::for_language(language);
    let references = segments
        .clone()
        .into_iter()
        .enumerate()
        .flat_map(|(index, (text, _))| {
            parser
                .detect(text)
                .into_iter()
                .map(move |found| (index, found))
        })
        .collect();
    // Structure, not text: what the headings say the sections are about.
    let sections = if sections::has_sections(format) {
        sections::derive(segments.into_iter().map(|(_, path)| path), parser)
    } else {
        Vec::new()
    };
    PassageIndex {
        language,
        references,
        sections,
    }
}

/// The language to index a source in, from its language label. A label that
/// names none of the supported languages (or no label) means English; that is
/// a fallback, and it is logged so it can be seen.
pub fn language_of(label: Option<&str>, what: &str) -> ReferenceLanguage {
    let resolved = ReferenceLanguage::resolve(label);
    if resolved.fallback {
        match label.map(str::trim).filter(|l| !l.is_empty()) {
            Some(unrecognised) => log::info!(
                "{what}: source language {unrecognised:?} has no reference dictionary; reading it as English"
            ),
            None => log::debug!("{what}: source has no language; reading it as English"),
        }
    }
    resolved.language
}

#[cfg(test)]
mod tests {
    use super::*;
    use ReferenceLanguage::{De, En, Ko};

    fn segments() -> Vec<(&'static str, Option<&'static str>)> {
        vec![
            (
                "Ein Absatz ohne Stelle.",
                Some("Kommentar › Joh 15,1–11 — Der wahre Weinstock"),
            ),
            (
                "Siehe auch Röm 8,28.",
                Some("Kommentar › Joh 15,1–11 — Der wahre Weinstock"),
            ),
        ]
    }

    #[test]
    fn the_language_decides_what_is_found() {
        let german = build("markdown", segments(), De);
        assert_eq!(german.language, De);
        assert_eq!(german.references.len(), 1);
        assert_eq!(german.references[0].1.reference.canonical, "ROM.8.28");
        assert_eq!(
            german.sections.len(),
            2,
            "a section link and an inherited one"
        );
        // the same source read as English finds different things
        let english = build("markdown", segments(), En);
        assert!(english
            .references
            .iter()
            .all(|(_, r)| r.reference.canonical != "ROM.8.28"));
        assert!(english
            .sections
            .iter()
            .all(|l| l.canonical != "JHN.15.1-JHN.15.11"));
    }

    #[test]
    fn a_format_without_structure_has_no_section_links() {
        let text = build("text", segments(), De);
        assert!(text.sections.is_empty());
        assert_eq!(text.references.len(), 1, "its explicit references remain");
        assert_eq!(text.references[0].1.reference.canonical, "ROM.8.28");
    }

    #[test]
    fn language_labels_resolve_with_an_english_fallback() {
        assert_eq!(language_of(Some("한국어"), "test"), Ko);
        assert_eq!(language_of(Some("de-AT"), "test"), De);
        assert_eq!(language_of(Some("Italiano"), "test"), En);
        assert_eq!(language_of(None, "test"), En);
        assert_eq!(language_of(Some("  "), "test"), En);
    }
}
