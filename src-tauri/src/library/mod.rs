//! The personal library: sources the user brings (PDF, EPUB, Word, Markdown,
//! plain text), with exact provenance for every extracted segment.
//! See docs/library-v0.4.md.

pub mod adapters;
pub mod contents;
pub mod files;
pub mod import;
pub mod original;

use serde::{Deserialize, Serialize};

use crate::scripture::reference::ScriptureRefDto;

macro_rules! text_enum {
    ($name:ident, $what:literal { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $text)] $variant),+ }
        impl $name {
            pub fn as_str(self) -> &'static str { match self { $($name::$variant => $text),+ } }
            pub fn parse(value: &str) -> Result<Self, crate::error::AppError> {
                match value {
                    $($text => Ok($name::$variant),)+
                    other => Err(crate::error::AppError::InvalidInput(
                        crate::error::UserMessage::new(
                            "invalidChoice",
                            format!(concat!("“{}” is not a valid ", $what, "."), other),
                        )
                        .with("value", other),
                    )),
                }
            }
        }
    };
}

text_enum!(SourceType, "source type" {
    Book => "book",
    Article => "article",
    Notes => "notes",
    Sermon => "sermon",
    Lecture => "lecture",
    Document => "document",
});

// private: the user's own copy, never to be redistributed (the default).
text_enum!(LicenceStatus, "licence status" {
    Private => "private",
    Distributable => "distributable",
    Unknown => "unknown",
});

impl SourceType {
    /// Sensible default for a format; the user can change it.
    pub fn default_for(format: &str) -> Self {
        match format {
            "pdf" | "epub" => Self::Book,
            "docx" => Self::Document,
            _ => Self::Notes,
        }
    }
}

/// A library source with its file and counts (detail view).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub edition: Option<String>,
    pub publication_year: Option<i64>,
    pub isbn: Option<String>,
    pub doi: Option<String>,
    pub language: Option<String>,
    pub source_type: SourceType,
    pub licence_status: LicenceStatus,
    pub licence: Option<String>,
    pub notes: Option<String>,
    pub format: Option<String>,
    pub original_filename: Option<String>,
    pub extraction_status: Option<String>,
    pub page_count: Option<i64>,
    /// How the original file can be viewed in the app, if it can.
    pub original_view: Option<original::OriginalView>,
    pub segment_count: i64,
    pub passage_count: i64,
    pub content_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One row of the library list.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub source_type: SourceType,
    pub format: Option<String>,
    pub language: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListSources {
    pub source_type: Option<SourceType>,
    pub language: Option<String>,
}

/// A segment with its provenance, for the reader.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSegment {
    pub id: String,
    pub position: i64,
    pub text: String,
    pub page_number: Option<i64>,
    pub page_label: Option<String>,
    pub chapter: Option<String>,
    pub heading: Option<String>,
    pub section_path: Option<String>,
    pub paragraph_index: Option<i64>,
    pub locator: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSegments {
    pub source_id: String,
    /// Centre the window on this segment (search result, citation).
    #[serde(default)]
    pub around_segment_id: Option<String>,
    /// Centre the window on this physical page (PDF), without marking a segment.
    #[serde(default)]
    pub around_page: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentWindow {
    pub source_id: String,
    pub total: i64,
    /// Position of the first segment returned.
    pub offset: i64,
    pub segments: Vec<SourceSegment>,
    /// The segment asked for, if any (to scroll to and mark).
    pub target_segment_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLibrary {
    pub query: String,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryHit {
    pub source_id: String,
    pub source_title: String,
    pub author: Option<String>,
    pub segment_id: String,
    pub position: i64,
    pub page_number: Option<i64>,
    pub locator: String,
    /// Matches wrapped in U+0002 … U+0003.
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryResults {
    pub hits: Vec<LibraryHit>,
    pub offset: i64,
    pub has_more: bool,
}

/// A place in the library that mentions a Scripture passage.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PassageMention {
    pub source_id: String,
    pub source_title: String,
    pub author: Option<String>,
    pub segment_id: String,
    pub locator: String,
    pub matched_text: String,
    pub reference: ScriptureRefDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateOf {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceImportPreview {
    pub preview_id: String,
    pub file_name: String,
    /// "pdf", "epub", "markdown", "text".
    pub format: &'static str,
    pub suggested_title: String,
    pub suggested_author: Option<String>,
    pub suggested_language: Option<String>,
    pub suggested_publisher: Option<String>,
    pub suggested_isbn: Option<String>,
    pub suggested_type: SourceType,
    pub page_count: Option<u32>,
    pub chapter_count: Option<u32>,
    pub segment_count: usize,
    pub reference_count: usize,
    pub extraction_status: &'static str,
    /// Why it cannot be added (e.g. a scanned PDF), in plain words.
    pub problem: Option<String>,
    /// Message code for `problem` (docs/i18n.md).
    pub problem_code: Option<String>,
    /// The same file is already in the library.
    pub duplicate_of: Option<DuplicateOf>,
    pub can_import: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommitSourceImport {
    pub preview_id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub edition: Option<String>,
    pub publication_year: Option<i64>,
    pub isbn: Option<String>,
    pub doi: Option<String>,
    pub language: Option<String>,
    pub source_type: Option<SourceType>,
    pub licence_status: Option<LicenceStatus>,
    pub licence: Option<String>,
    pub notes: Option<String>,
    /// Add even though the same file is already in the library.
    pub allow_duplicate: bool,
}

/// A finding's citation of a library source.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FindingCitation {
    pub id: String,
    pub finding_id: String,
    pub source_id: String,
    /// None once the source has been removed from the library.
    pub segment_id: Option<String>,
    pub title: String,
    pub author: Option<String>,
    /// e.g. "p. 152", "Chapter 3 › Grace".
    pub locator: Option<String>,
    /// The source was removed; the citation remains as a record.
    pub removed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddFindingSource {
    pub finding_id: String,
    pub segment_id: String,
}
