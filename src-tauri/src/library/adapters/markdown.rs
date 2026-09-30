//! Markdown (.md, .markdown): headings build a section path; paragraphs,
//! list items, quotations and code keep their order. Embedded HTML is
//! dropped, never interpreted or executed.

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};

use super::text::decode_utf8;
use super::{
    collapse, split_long, ExtractionStatus, FoundMetadata, ImportedDocument, NewSegment,
    SourceImportAdapter,
};
use crate::error::AppResult;

pub struct MarkdownImporter;

const MAX_SEGMENT: usize = 1_500;

fn level(heading: HeadingLevel) -> usize {
    match heading {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

impl SourceImportAdapter for MarkdownImporter {
    fn format(&self) -> &'static str {
        "markdown"
    }

    fn accepts(&self, extension: &str) -> bool {
        matches!(extension, "md" | "markdown")
    }

    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument> {
        let source = decode_utf8(bytes, file_name)?;
        let mut segments: Vec<NewSegment> = Vec::new();
        // headings[0] = H1 text, headings[1] = H2 …
        let mut headings: Vec<Option<String>> = vec![None; 6];
        let mut title: Option<String> = None;
        let mut top_level = 0u32;
        let mut buffer = String::new();
        let mut in_heading: Option<usize> = None;
        let mut block_start = 0usize;
        let mut paragraph_in_section = 0u32;

        let path = |headings: &[Option<String>]| -> Option<String> {
            let parts: Vec<&str> = headings.iter().flatten().map(String::as_str).collect();
            (!parts.is_empty()).then(|| parts.join(" › "))
        };

        for (event, range) in Parser::new(&source).into_offset_iter() {
            match event {
                Event::Start(Tag::Heading { level: l, .. }) => {
                    in_heading = Some(level(l));
                    buffer.clear();
                }
                Event::End(TagEnd::Heading(_)) => {
                    let text = collapse(&buffer);
                    buffer.clear();
                    if let Some(l) = in_heading.take() {
                        if l == 1 && title.is_none() {
                            title = Some(text.clone());
                        }
                        if l <= 2 {
                            top_level += 1;
                        }
                        headings[l - 1] = Some(text);
                        for deeper in headings.iter_mut().skip(l) {
                            *deeper = None;
                        }
                        paragraph_in_section = 0;
                    }
                }
                Event::Start(Tag::Paragraph | Tag::CodeBlock(_) | Tag::Item) => {
                    buffer.clear();
                    block_start = range.start;
                }
                // A tight list item has text but no paragraph of its own.
                Event::End(TagEnd::Paragraph | TagEnd::CodeBlock | TagEnd::Item) => {
                    let text = collapse(&buffer);
                    buffer.clear();
                    if text.is_empty() {
                        continue;
                    }
                    let section_path = path(&headings);
                    let heading = headings.iter().rev().flatten().next().cloned();
                    for part in split_long(&text, MAX_SEGMENT) {
                        segments.push(NewSegment {
                            text: part,
                            chapter: headings[0].clone(),
                            heading: heading.clone(),
                            section_path: section_path.clone(),
                            paragraph_index: Some(paragraph_in_section),
                            char_start: Some(block_start as u32),
                            char_end: Some(range.end as u32),
                            ..Default::default()
                        });
                        paragraph_in_section += 1;
                    }
                }
                Event::Text(t) | Event::Code(t) => buffer.push_str(&t),
                Event::SoftBreak | Event::HardBreak => buffer.push(' '),
                // Raw HTML is ignored: never rendered, never executed.
                Event::Html(_) | Event::InlineHtml(_) => {}
                _ => {}
            }
        }

        Ok(ImportedDocument {
            format: "markdown",
            metadata: FoundMetadata {
                title,
                ..Default::default()
            },
            segments,
            extraction_status: ExtractionStatus::DigitalText,
            page_count: None,
            chapter_count: Some(top_level),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_heading_hierarchy_and_paragraph_order() {
        let md = "# Romans Notes\n\nIntro line.\n\n## Justification\n\nDeclared righteous.\n\n- by faith\n\n### Imputation\n\nCounted, not infused.\n\n## Adoption\n\n<script>alert(1)</script>\n\nSons and heirs.";
        let doc = MarkdownImporter
            .extract(md.as_bytes(), "romans.md")
            .unwrap();
        assert_eq!(doc.metadata.title.as_deref(), Some("Romans Notes"));
        let seen: Vec<_> = doc
            .segments
            .iter()
            .map(|s| (s.text.as_str(), s.section_path.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(
            seen,
            [
                ("Intro line.", "Romans Notes"),
                ("Declared righteous.", "Romans Notes › Justification"),
                ("by faith", "Romans Notes › Justification"),
                (
                    "Counted, not infused.",
                    "Romans Notes › Justification › Imputation"
                ),
                ("Sons and heirs.", "Romans Notes › Adoption"),
            ]
        );
        assert!(doc
            .segments
            .iter()
            .all(|s| !s.text.contains("script") && !s.text.contains("alert")));
        assert_eq!(doc.segments[3].heading.as_deref(), Some("Imputation"));
        assert!(doc.segments.iter().all(|s| s.page_number.is_none()));
    }
}
