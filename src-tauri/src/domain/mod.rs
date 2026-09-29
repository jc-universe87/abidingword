//! Domain types shared by the database layer and the command layer.
//!
//! Everything here is serialised to the frontend with camelCase field names.
//! The TypeScript mirror lives in `src/types/domain.ts`; keep the two in step.

pub mod validate;

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub description: Option<String>,
    pub study_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Study {
    pub id: String,
    pub project_id: String,
    pub template_id: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

/// A study together with its sections and their blocks, in display order.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyDetail {
    pub study: Study,
    pub sections: Vec<StudySection>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudySection {
    pub id: String,
    pub study_id: String,
    pub key: Option<String>,
    pub title: String,
    pub guidance: Option<String>,
    pub position: i64,
    pub blocks: Vec<StudyBlock>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyBlock {
    pub id: String,
    pub section_id: String,
    pub block_type: BlockType,
    pub position: i64,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

/// The kinds of content a study block can hold.
///
/// Stored as text, so adding a variant (quotation, word_study,
/// source_citation, ...) needs no schema change: add it here, in
/// `src/types/domain.ts`, and give it an editor in the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Paragraph,
    Note,
    Heading,
}

impl BlockType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Paragraph => "paragraph",
            Self::Note => "note",
            Self::Heading => "heading",
        }
    }
}

impl fmt::Display for BlockType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for BlockType {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "paragraph" => Ok(Self::Paragraph),
            "note" => Ok(Self::Note),
            "heading" => Ok(Self::Heading),
            other => Err(AppError::Unexpected(format!(
                "unknown block type in database: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyTemplate {
    pub id: String,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub is_builtin: bool,
    pub sections: Vec<TemplateSection>,
}

/// The JSON shape of a template file in `resources/templates/`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDefinition {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub sections: Vec<TemplateSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSection {
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub guidance: Option<String>,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: Theme,
    /// The translation the Scripture pane shows.
    pub scripture_translation_id: Option<String>,
    /// The active passage, as a canonical reference (e.g. `JHN.15.1-JHN.15.11`).
    pub scripture_passage: Option<String>,
}

// ---------------------------------------------------------------------------
// Command inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProject {
    pub workspace_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Fields left out are unchanged. An empty description clears it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProject {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudy {
    pub project_id: String,
    pub title: String,
    /// Defaults to the built-in passage study.
    #[serde(default)]
    pub template_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStudy {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStudySection {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyBlock {
    pub section_id: String,
    pub block_type: BlockType,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStudyBlock {
    pub id: String,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    #[serde(default)]
    pub theme: Option<Theme>,
    /// An empty string clears the setting.
    #[serde(default)]
    pub scripture_translation_id: Option<String>,
    /// A canonical reference; an empty string clears the setting.
    #[serde(default)]
    pub scripture_passage: Option<String>,
}
