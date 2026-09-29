//! The Scripture domain: canon, references, parsing, import.
//!
//! Scripture is a first-class domain (docs/architecture.md §6), not a
//! source document. Everything here is keyed by canonical references that
//! do not depend on any translation; see docs/scripture-v0.2.md.

pub mod bundled;
pub mod canon;
pub mod import;
pub mod parser;
pub mod reference;
pub mod usfm;

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
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnotation {
    pub reference: String,
    pub kind: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub translation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAnnotation {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyPassage {
    pub id: String,
    pub study_id: String,
    pub reference: ScriptureRefDto,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddStudyPassage {
    pub study_id: String,
    pub reference: String,
}
