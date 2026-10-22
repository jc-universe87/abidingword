//! The personal library: sources the user brings (PDF, EPUB, Word, Markdown,
//! plain text), with exact provenance for every extracted segment.
//! See docs/library-v0.4.md.

pub mod adapters;
pub mod annotations;
pub mod contents;
pub mod files;
pub mod find;
pub mod generated_contents;
pub mod import;
pub mod original;
pub mod passage_index;
pub mod relevance;
pub mod sections;

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

/// A Scripture reference written in a segment's text, where it is (v0.11): what
/// the Reading view turns into an "Open in Bible" action. Read from the stored
/// index (`source_passages`, explicit links), never by parsing again.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceReference {
    /// The segment's position in the source.
    pub position: i64,
    /// UTF-16 offsets into the segment's text, end exclusive.
    pub start: i64,
    pub end: i64,
    pub reference: ScriptureRefDto,
}

/// One place a "Find in this source" query occurs (v0.13).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceMatch {
    /// The segment's position in the source.
    pub position: i64,
    /// The segment's printed page, where the source has pages.
    pub page_number: Option<i64>,
    /// UTF-16 offsets into the segment's text, end exclusive.
    pub start: i64,
    pub end: i64,
}

/// Where a query occurs in one source, in reading order (v0.13). `total`
/// counts every occurrence up to a bound; `matches` holds the first of them;
/// `truncated` says the bound was reached and more may exist.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceFind {
    pub matches: Vec<SourceMatch>,
    pub total: i64,
    pub truncated: bool,
}

/// Why a source segment is linked to a passage, for one segment (the reader).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentPassageLink {
    pub origin: sections::LinkOrigin,
    pub reference: ScriptureRefDto,
    /// The reference as written in the source (the heading, for a section).
    pub matched_text: String,
    /// The defining heading, for a section or inherited link.
    pub section_heading: Option<String>,
    /// The first segment of the defining section (where it opens).
    pub section_segment_id: Option<String>,
}

/// One place in a source that fits the passage being read.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PassageLocation {
    pub segment_id: String,
    pub locator: String,
    /// `explicit` (mentions it), `section` (a heading names it) or `manual`.
    pub origin: sections::LinkOrigin,
    /// How the link relates to the passage being read.
    pub match_kind: relevance::MatchKind,
    /// The passage the source links this place to.
    pub reference: ScriptureRefDto,
    /// The reference as written in the source (the heading, for a section).
    pub matched_text: String,
    pub section_heading: Option<String>,
}

/// A source with the places in it that fit the passage being read, best first.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PassageSourceGroup {
    pub source_id: String,
    pub source_title: String,
    pub author: Option<String>,
    /// The best few places (see `db::library::LOCATIONS_PER_SOURCE`).
    pub locations: Vec<PassageLocation>,
    /// How many further places the source has.
    pub more_locations: i64,
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
    /// None when the cited source is not on this computer (a project
    /// imported from elsewhere, v0.19): the citation stands on its snapshot.
    pub source_id: Option<String>,
    /// None once the source has been removed from the library.
    pub segment_id: Option<String>,
    pub title: String,
    pub author: Option<String>,
    /// e.g. "p. 152", "Chapter 3 › Grace".
    pub locator: Option<String>,
    /// The source cannot be opened (removed, or not on this computer); the
    /// citation remains as a record.
    pub removed: bool,
    /// The source is not on this computer at all (v0.19): it was cited where
    /// the project was made. Title, author, words and place are kept.
    pub unavailable: bool,
    /// What the source said: the cited words, as they were (v0.15).
    pub quote: Option<String>,
    /// The section path at the time, e.g. "Chapter 3 › Grace" (v0.15).
    pub section: Option<String>,
    /// The source mark it was made from, if any (a weak link; v0.15).
    pub annotation_id: Option<String>,
}

/// Cites a library source from an existing finding: a whole paragraph (as
/// since v0.4), or (v0.15) selected words or a place, like a new finding
/// from a source.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AddFindingSource {
    pub finding_id: String,
    /// A whole paragraph.
    pub segment_id: Option<String>,
    /// Or what is cited, as for a new finding.
    #[serde(flatten)]
    pub cited: CitedPassage,
}

/// What a finding cites in a source (v0.15): selected words (both ends and
/// the quote, segments joined with "\n"), a place (a paragraph, or a page of
/// an Original PDF), or a source mark, which gives its own words or place.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CitedPassage {
    pub source_id: Option<String>,
    pub start: Option<annotations::TextPoint>,
    pub end: Option<annotations::TextPoint>,
    pub quote: Option<String>,
    pub place: Option<annotations::PlaceInput>,
    pub annotation_id: Option<String>,
}

/// A new finding made from a source (v0.15 "Add to Study").
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateFindingFromSource {
    pub study_id: String,
    pub finding_type: String,
    /// What the person wrote; may be empty when there are cited words.
    pub content: Option<String>,
    pub section_id: Option<String>,
    #[serde(flatten)]
    pub cited: CitedPassage,
}

/// Where a citation is in its source now, to open it there (v0.15).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationPlace {
    pub source_id: String,
    /// The paragraph to open at (where the words begin), if known.
    pub segment_id: Option<String>,
    /// The words, when they were found exactly: both ends in the stored text.
    pub words: Option<CitationWords>,
    /// A page of an Original PDF (a place with no paragraph), and how far down it.
    pub page: Option<i64>,
    pub fraction: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationWords {
    pub start_segment_id: String,
    pub start_offset: u32,
    pub end_segment_id: String,
    pub end_offset: u32,
}
