//! A source's own table of contents, as one small typed tree.
//!
//! The contents a publication ships with (an EPUB's navigation document or
//! NCX) are preserved as nested items; nothing is generated or guessed. A
//! target is an internal place only: for an EPUB, the reading-order position
//! of a segment of the extracted text. Raw markup, file paths and external
//! links never reach the interface.

use serde::Serialize;

/// Most entries and deepest nesting kept; a book with more is cut off rather
/// than allowed to grow without bound.
pub const MAX_ITEMS: usize = 5_000;
pub const MAX_DEPTH: usize = 12;
pub const MAX_LINKS: usize = 50_000;
const MAX_TITLE_CHARS: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentsItem {
    /// Stable within one source's contents ("n0", "n1", … in reading order).
    pub id: String,
    pub title: String,
    /// None for a heading that only groups its children.
    pub target: Option<ContentsTarget>,
    pub children: Vec<ContentsItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContentsTarget {
    /// The segment at this position of the source's extracted text.
    Segment { position: i64 },
    /// A physical page of a PDF (1 = first), for generated contents.
    Page { page: i64 },
}

/// A title as shown: whitespace collapsed, bounded.
pub fn clean_title(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(MAX_TITLE_CHARS).collect()
}

/// A link inside a source's text that leads to another place in the same
/// source: where it is and where it goes, as positions of the extracted
/// text. The range counts UTF-16 units of the segment's text, as the
/// interface does. External links never appear here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    /// The segment the link is in.
    pub position: i64,
    pub start: usize,
    pub end: usize,
    /// The segment it leads to.
    pub target: i64,
}
