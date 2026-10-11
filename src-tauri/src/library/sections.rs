//! Section-derived Scripture links (docs/passage-aware-sources-v0.9.md).
//!
//! A commentary heading such as "John 15:1–11 — The True Vine" says what the
//! paragraphs below it are about, although none of them repeats the reference.
//! The importers keep headings as structure (`section_path`, e.g.
//! "Commentary › John 15:1–11 — The True Vine"), not as segments, so the
//! reference detector never sees them. This module derives, deterministically
//! and only from that stored structure:
//!
//! * a **section** link on the first segment of a section whose heading names a
//!   passage (its opening place), and
//! * an **inherited** link on every later segment of that section.
//!
//! # Rules
//!
//! 1. A section is a heading and everything below it: the run of consecutive
//!    segments whose path starts with the heading's path. It ends where the path
//!    leaves that prefix (a sibling or a higher heading starts, or a segment
//!    without a path, such as a footnote).
//! 2. A heading names a passage only through references written in its own
//!    text (every reference, each kept separately; at most
//!    [`MAX_REFERENCES_PER_HEADING`]). Body text never creates or changes a
//!    section's passage; a segment's own references stay its explicit links.
//! 3. A segment inherits from the **nearest** heading at or above it that
//!    names a passage, and only from that one: a narrower section is not widened
//!    by the chapter heading above it, and a sibling section never leaks into
//!    the next. A section without a passage of its own under one that has one
//!    belongs to the ancestor's passage.
//! 4. Formats without structure (plain text, PDF) have no `section_path`, so
//!    nothing is derived; [`has_sections`] names the formats that do.
//!
//! The same function builds the links when a source is imported and when an
//! existing library is re-indexed from the stored paths, so both give the same
//! result for the same source.

use crate::scripture::recognise::Recogniser;

/// The version of the whole passage index: how references are found
/// (`scripture::parser`, by the source's language) and how sections are derived
/// (this module). Bumped when either changes, so sources indexed by an older
/// rule are rebuilt at the next start (`sources.passage_index_version`).
///
/// * 1 – section and inherited links from headings (English detection only).
/// * 2 – language-aware detection: explicit and section links are made with the
///   dictionary of the source's language, and both are rebuilt.
/// * 3 – contextual references (v0.13.1): bookless references such as `15:4`,
///   `15,4` or `v. 4` resolved from the source's own explicit references
///   nearby (`scripture::parser::context`).
/// * 4 – explicit references in every supported language, the source's first
///   (`scripture::recognise`), and visible heading lines as local context (v0.13.2).
pub const INDEX_VERSION: i64 = 4;

/// What the importers put between the headings of a `section_path`.
pub const PATH_SEPARATOR: &str = " › ";

/// A heading naming more passages than this is almost certainly a list, not a
/// subject; the first ones are kept and the rest left to the text itself.
pub const MAX_REFERENCES_PER_HEADING: usize = 8;

/// Why a segment is linked to a passage (`source_passages.origin`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkOrigin {
    /// The segment's own text contains the reference.
    Explicit,
    /// The heading that opens this section names the passage.
    Section,
    /// The segment is inside a section whose heading names the passage.
    Inherited,
    /// A person confirmed the link (reserved; nothing writes it yet).
    Manual,
}

impl LinkOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Section => "section",
            Self::Inherited => "inherited",
            Self::Manual => "manual",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "explicit" => Some(Self::Explicit),
            "section" => Some(Self::Section),
            "inherited" => Some(Self::Inherited),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }
}

/// Whether sources of this format carry heading structure worth deriving from.
pub fn has_sections(format: &str) -> bool {
    matches!(format, "epub" | "docx" | "markdown")
}

/// One derived link, by segment index in the source's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedLink {
    pub segment_index: usize,
    /// [`LinkOrigin::Section`] or [`LinkOrigin::Inherited`].
    pub origin: LinkOrigin,
    /// The first segment of the defining section (the opening place).
    pub opener_index: usize,
    /// The defining heading's text.
    pub heading: String,
    /// The passage, canonical (e.g. `JHN.15.1-JHN.15.11`).
    pub canonical: String,
    /// The reference as written in the heading (e.g. `John 15:1–11`).
    pub matched_text: String,
}

struct Reference {
    canonical: String,
    text: String,
}

struct Node {
    component: String,
    first_segment: usize,
    references: Vec<Reference>,
}

fn references_of(heading: &str, parser: &Recogniser) -> Vec<Reference> {
    let mut seen: Vec<Reference> = Vec::new();
    for found in parser.detect(heading) {
        if seen
            .iter()
            .any(|r| r.canonical == found.reference.canonical)
        {
            continue;
        }
        seen.push(Reference {
            canonical: found.reference.canonical,
            text: found.text,
        });
        if seen.len() == MAX_REFERENCES_PER_HEADING {
            break;
        }
    }
    seen
}

/// The headings of a stored `section_path`, outermost first.
pub fn components(path: &str) -> impl Iterator<Item = &str> {
    path.split(PATH_SEPARATOR)
        .map(str::trim)
        .filter(|c| !c.is_empty())
}

/// Derives the section and inherited links of a source whose segments have
/// these section paths, in reading order (`None` for a segment without one).
pub fn derive<'a>(
    paths: impl IntoIterator<Item = Option<&'a str>>,
    parser: &Recogniser,
) -> Vec<DerivedLink> {
    let mut out = Vec::new();
    // The headings that enclose the segment being read, outermost first.
    let mut open: Vec<Node> = Vec::new();
    for (index, path) in paths.into_iter().enumerate() {
        let parts: Vec<&str> = path.map(|p| components(p).collect()).unwrap_or_default();
        let shared = open
            .iter()
            .zip(&parts)
            .take_while(|(node, part)| node.component == **part)
            .count();
        open.truncate(shared);
        for part in &parts[shared..] {
            let node = Node {
                component: (*part).to_string(),
                first_segment: index,
                references: references_of(part, parser),
            };
            // A heading opens its section on the segment that follows it.
            for reference in &node.references {
                out.push(DerivedLink {
                    segment_index: index,
                    origin: LinkOrigin::Section,
                    opener_index: index,
                    heading: node.component.clone(),
                    canonical: reference.canonical.clone(),
                    matched_text: reference.text.clone(),
                });
            }
            open.push(node);
        }
        // Everywhere else in the section the nearest naming heading applies,
        // except on its own opening segment, which already carries it.
        if let Some(node) = open.iter().rev().find(|n| !n.references.is_empty()) {
            if node.first_segment != index {
                for reference in &node.references {
                    out.push(DerivedLink {
                        segment_index: index,
                        origin: LinkOrigin::Inherited,
                        opener_index: node.first_segment,
                        heading: node.component.clone(),
                        canonical: reference.canonical.clone(),
                        matched_text: reference.text.clone(),
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(paths: &[Option<&str>]) -> Vec<(usize, LinkOrigin, usize, String)> {
        derive(
            paths.iter().copied(),
            Recogniser::for_source(crate::scripture::language::ReferenceLanguage::En),
        )
        .into_iter()
        .map(|l| (l.segment_index, l.origin, l.opener_index, l.canonical))
        .collect()
    }

    use LinkOrigin::{Inherited as I, Section as S};

    #[test]
    fn a_heading_links_its_opening_segment_and_those_after_it() {
        let path = Some("Notes on Acts › Acts 2:1–4 — Pentecost");
        let got = run(&[path, path, path]);
        assert_eq!(
            got,
            [
                (0, S, 0, "ACT.2.1-ACT.2.4".into()),
                (1, I, 0, "ACT.2.1-ACT.2.4".into()),
                (2, I, 0, "ACT.2.1-ACT.2.4".into()),
            ]
        );
    }

    #[test]
    fn a_sibling_section_does_not_inherit_the_previous_one() {
        let a = Some("Book › Acts 2:1–4 — Wind");
        let b = Some("Book › Acts 2:5–13 — Tongues");
        let none = Some("Book › Closing thoughts");
        let got = run(&[a, a, b, b, none, none]);
        assert_eq!(
            got,
            [
                (0, S, 0, "ACT.2.1-ACT.2.4".into()),
                (1, I, 0, "ACT.2.1-ACT.2.4".into()),
                (2, S, 2, "ACT.2.5-ACT.2.13".into()),
                (3, I, 2, "ACT.2.5-ACT.2.13".into()),
            ]
        );
    }

    #[test]
    fn a_section_without_a_passage_belongs_to_the_nearest_ancestor_that_has_one() {
        let chapter = Some("Commentary › Ruth 1");
        let plain = Some("Commentary › Ruth 1 › Application");
        let narrow = Some("Commentary › Ruth 1 › Ruth 1:16–17 — Where you go");
        let after = Some("Commentary › Ruth 1 › Closing");
        let got = run(&[chapter, plain, narrow, narrow, after]);
        assert_eq!(
            got,
            [
                (0, S, 0, "RUT.1".into()),
                (1, I, 0, "RUT.1".into()),
                (2, S, 2, "RUT.1.16-RUT.1.17".into()),
                (3, I, 2, "RUT.1.16-RUT.1.17".into()),
                // the narrower sibling's passage does not leak; the chapter's applies
                (4, I, 0, "RUT.1".into()),
            ]
        );
    }

    #[test]
    fn a_narrow_section_is_not_widened_by_the_heading_above() {
        let chapter = Some("Commentary › Ruth 1");
        let narrow = Some("Commentary › Ruth 1 › Ruth 1:16–17");
        let got = run(&[chapter, narrow, narrow]);
        // segment 1 and 2 carry only the nearest passage, not also Ruth 1
        assert_eq!(
            got,
            [
                (0, S, 0, "RUT.1".into()),
                (1, S, 1, "RUT.1.16-RUT.1.17".into()),
                (2, I, 1, "RUT.1.16-RUT.1.17".into()),
            ]
        );
    }

    #[test]
    fn nested_headings_open_together_on_one_segment() {
        let both = Some("Commentary › Ruth 1 › Ruth 1:1–5");
        let got = run(&[both]);
        assert_eq!(
            got,
            [
                (0, S, 0, "RUT.1".into()),
                (0, S, 0, "RUT.1.1-RUT.1.5".into()),
            ]
        );
    }

    #[test]
    fn several_references_in_one_heading_are_all_kept_separately() {
        let path = Some("Study › John 15:1–11 and Isaiah 5:1–7");
        let got = run(&[path, path]);
        assert_eq!(
            got,
            [
                (0, S, 0, "JHN.15.1-JHN.15.11".into()),
                (0, S, 0, "ISA.5.1-ISA.5.7".into()),
                (1, I, 0, "JHN.15.1-JHN.15.11".into()),
                (1, I, 0, "ISA.5.1-ISA.5.7".into()),
            ]
        );
    }

    #[test]
    fn the_same_reference_twice_in_a_heading_is_one_link() {
        let path = Some("Study › John 3:16 (yes, John 3:16)");
        assert_eq!(run(&[path]).len(), 1);
    }

    #[test]
    fn a_heading_with_a_flood_of_references_keeps_only_the_first_few() {
        let heading = (1..=20)
            .map(|v| format!("Psalm 23:{v}"))
            .collect::<Vec<_>>()
            .join(", ");
        let path = format!("Index › {heading}");
        let got = run(&[Some(path.as_str())]);
        assert_eq!(got.len(), MAX_REFERENCES_PER_HEADING);
    }

    #[test]
    fn body_references_never_change_a_sections_passage() {
        // Structure alone decides: nothing here is read from segment text.
        let path = Some("Book › Psalm 23");
        let got = run(&[path, path, path]);
        assert!(got.iter().all(|(_, _, _, c)| c == "PSA.23"));
        assert_eq!(got.len(), 3);
    }

    #[test]
    fn unrelated_sections_and_unstructured_segments_get_nothing() {
        let intro = Some("Book › Introduction");
        let got = run(&[intro, intro, None, None]);
        assert!(got.is_empty());
    }

    #[test]
    fn a_segment_without_a_path_ends_the_section() {
        let path = Some("Book › Acts 2");
        let got = run(&[path, None, path]);
        // the section reopens after the gap (a new opening segment)
        assert_eq!(got, [(0, S, 0, "ACT.2".into()), (2, S, 2, "ACT.2".into())]);
    }

    #[test]
    fn a_book_name_alone_names_no_passage() {
        let path = Some("Commentary on John › Introduction to the Gospel");
        assert!(run(&[path]).is_empty());
    }

    #[test]
    fn components_split_on_the_importers_separator_and_drop_blanks() {
        let parts: Vec<_> = components("A › B ›  › C").collect();
        assert_eq!(parts, ["A", "B", "C"]);
    }

    #[test]
    fn only_structured_formats_derive_sections() {
        assert!(has_sections("epub") && has_sections("docx") && has_sections("markdown"));
        assert!(!has_sections("pdf") && !has_sections("text"));
    }

    #[test]
    fn origins_round_trip_through_their_stored_names() {
        for origin in [
            LinkOrigin::Explicit,
            LinkOrigin::Section,
            LinkOrigin::Inherited,
            LinkOrigin::Manual,
        ] {
            assert_eq!(LinkOrigin::parse(origin.as_str()), Some(origin));
        }
        assert_eq!(LinkOrigin::parse("magic"), None);
    }
}
