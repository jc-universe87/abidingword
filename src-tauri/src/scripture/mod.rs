//! The Scripture domain: canon, references, parsing, import.
//!
//! Scripture is a first-class domain (docs/architecture.md §6), not a
//! source document. Everything here is keyed by canonical references that
//! do not depend on any translation; see docs/scripture-v0.2.md.

pub mod aliases;
pub mod annotation_data;
pub mod bundled;
pub mod canon;
pub mod concordance;
pub mod data_packs;
pub mod import;
pub mod language;
pub mod packs;
pub mod parser;
pub mod phrase_ranges;
pub mod recognise;
pub mod reference;
pub mod resolve;
pub mod usfm;
pub mod verse_counts;

use serde::{Deserialize, Serialize};

use crate::scripture::reference::ScriptureRefDto;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookInfo {
    pub ordinal: u8,
    pub code: &'static str,
    pub name: &'static str,
    pub testament: canon::Testament,
    pub chapter_count: u16,
}

pub fn books() -> Vec<BookInfo> {
    canon::BOOKS
        .iter()
        .map(|b| BookInfo {
            ordinal: b.ordinal,
            code: b.code,
            name: b.name,
            testament: b.testament,
            chapter_count: b.chapter_count,
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BibleTranslation {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub language: String,
    pub language_code: Option<String>,
    pub publisher: Option<String>,
    pub copyright_notice: Option<String>,
    pub license_type: Option<String>,
    /// "structured" or "document".
    pub kind: String,
    pub source_type: String,
    /// "bundled" or "managed_copy".
    pub source_origin: String,
    pub source_path: Option<String>,
    pub original_file_name: Option<String>,
    pub import_status: String,
    pub is_builtin: bool,
    pub book_count: i64,
    pub verse_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundledBibleInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub short_name: &'static str,
    pub language: &'static str,
    pub language_code: &'static str,
    pub license_type: &'static str,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerseText {
    pub canonical: String,
    pub chapter: u16,
    pub verse: u16,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterText {
    pub translation_id: String,
    pub book: &'static str,
    pub book_name: &'static str,
    pub chapter: u16,
    pub chapter_count: u16,
    pub superscription: Option<String>,
    pub verses: Vec<VerseText>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PassageText {
    pub translation_id: String,
    pub reference: ScriptureRefDto,
    pub verses: Vec<VerseText>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetChapter {
    pub translation_id: String,
    pub book: String,
    pub chapter: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetPassage {
    pub translation_id: String,
    pub reference: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScripture {
    pub query: String,
    #[serde(default)]
    pub translation_id: Option<String>,
    #[serde(default)]
    pub book: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub reference: ScriptureRefDto,
    pub translation_id: String,
    pub translation_short_name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    /// True when more matches exist than were returned.
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    /// Files chosen by the user…
    #[serde(default)]
    pub paths: Vec<String>,
    /// …or the id of a bundled Bible.
    #[serde(default)]
    pub bundled: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitImport {
    pub preview_id: String,
    pub name: String,
    pub short_name: String,
    pub language: String,
    #[serde(default)]
    pub language_code: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub copyright_notice: Option<String>,
    #[serde(default)]
    pub license_type: Option<String>,
}

pub const ANNOTATION_KINDS: [&str; 3] = ["note", "highlight", "bookmark"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub reference: ScriptureRefDto,
    pub translation_id: Option<String>,
    pub kind: String,
    pub content: String,
    /// Highlights only; a highlight without a stored colour is the default.
    pub color: Option<String>,
    /// Phrase highlights and phrase notes only.
    pub anchor: Option<AnchorView>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

/// What to show in the Marks view. Everything is optional: with nothing set,
/// every mark in canonical order.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MarksQuery {
    /// "note", "highlight" or "bookmark"; all kinds when left out.
    pub kind: Option<String>,
    /// A canonical book code (e.g. `JHN`); all books when left out.
    pub book: Option<String>,
    /// One highlight colour (highlights only).
    pub color: Option<String>,
    /// Words to look for in note text (notes only, case-insensitive).
    pub query: Option<String>,
    /// The translation shown, so phrase marks can say whether they fit it.
    pub translation_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarksPage {
    pub marks: Vec<Annotation>,
    pub offset: i64,
    /// More marks follow this page.
    pub has_more: bool,
}

/// One end of a phrase anchor: a canonical verse and a UTF-16 offset into
/// its text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorEnd {
    /// Canonical single verse, e.g. `JHN.15.4`.
    pub verse: String,
    pub offset: u32,
}

/// A phrase anchor as the interface sees it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorView {
    pub start: AnchorEnd,
    pub end: AnchorEnd,
    pub quote: String,
    /// Short name of the translation it was marked in (a snapshot).
    pub translation_short_name: String,
    /// True when the translation asked about has exactly this wording, so
    /// the phrase can be drawn. False when no translation was given.
    pub shown: bool,
}

/// A phrase selection in one translation, to be checked by the core.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorInput {
    pub translation_id: String,
    pub start: AnchorEnd,
    pub end: AnchorEnd,
    /// The words the interface saw selected; must equal the core's rebuild.
    pub quote: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnotation {
    pub reference: String,
    pub kind: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub translation_id: Option<String>,
    /// Highlights only; the default colour when left out.
    #[serde(default)]
    pub color: Option<String>,
    /// Phrase highlights and phrase notes; `reference` must then be the
    /// verse range the anchor covers.
    #[serde(default)]
    pub anchor: Option<AnchorInput>,
}

/// Fields left out are unchanged.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAnnotation {
    pub id: String,
    #[serde(default)]
    pub content: Option<String>,
    /// Highlights only.
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPassage {
    pub id: String,
    pub study_id: String,
    pub reference: ScriptureRefDto,
    pub role: crate::domain::PassageRole,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddStudyPassage {
    pub study_id: String,
    pub reference: String,
    /// Default: primary if the study has no primary passage yet, otherwise
    /// related. Choosing primary makes any existing primary related.
    #[serde(default)]
    pub role: Option<crate::domain::PassageRole>,
}
