//! Studies v0.3 domain types: study types and status, findings, relations,
//! study search. Serialised to the frontend in camelCase; the TypeScript
//! mirror is `src/types/studies.ts`.

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::scripture::reference::ScriptureRefDto;

/// A closed set of values stored as text. Generates `as_str`, `parse`
/// (with a plain error message) and `ALL`.
macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident, $what:literal { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }

            pub fn parse(value: &str) -> Result<Self, AppError> {
                match value {
                    $($text => Ok($name::$variant),)+
                    other => Err(AppError::InvalidInput(format!(
                        concat!("“{}” is not a valid ", $what, "."), other
                    ))),
                }
            }
        }
    };
}

text_enum!(
    /// What kind of study this is. Influences template suggestions, optional
    /// details and wording; never a fixed workflow.
    StudyType, "study type" {
        Passage => "passage",
        Word => "word",
        Topical => "topical",
        BiblicalTheology => "biblical_theology",
        SystematicTheology => "systematic_theology",
        Teaching => "teaching",
        Custom => "custom",
    }
);

text_enum!(StudyStatus, "study status" {
    Active => "active",
    Paused => "paused",
    Completed => "completed",
    Archived => "archived",
});

text_enum!(FindingType, "finding type" {
    Observation => "observation",
    Interpretation => "interpretation",
    Question => "question",
    Quotation => "quotation",
    Doctrine => "doctrine",
    Application => "application",
    Illustration => "illustration",
    TeachingIdea => "teaching_idea",
    UnresolvedIssue => "unresolved_issue",
    Conclusion => "conclusion",
});

text_enum!(RelationType, "relation type" {
    Related => "related",
    Continues => "continues",
    Contrasts => "contrasts",
    Supports => "supports",
    Custom => "custom",
});

text_enum!(PassageRole, "passage role" {
    Primary => "primary",
    Related => "related",
});

/// Optional, type-dependent study details, stored as JSON. Fields exist so
/// later milestones (word studies, teaching) have a home; v0.3 only stores
/// and shows them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StudyDetails {
    /// Word study: the word as studied, e.g. "δικαιοσύνη".
    pub lemma: Option<String>,
    /// Word study: ISO 639-3 code, e.g. "grc", "hbo".
    pub original_language: Option<String>,
    /// Word study: a lexicon identifier, once lexical data exists.
    pub lexical_id: Option<String>,
    /// Teaching study.
    pub audience: Option<String>,
    pub duration: Option<String>,
    pub teaching_format: Option<String>,
}

/// One row of a study list: enough to show, nothing heavy.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudySummary {
    pub id: String,
    pub project_id: String,
    pub project_title: String,
    pub title: String,
    pub study_type: StudyType,
    pub status: StudyStatus,
    pub primary_passage: Option<ScriptureRefDto>,
    pub finding_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListStudies {
    pub project_id: Option<String>,
    pub study_type: Option<StudyType>,
    pub status: Option<StudyStatus>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateStudy {
    pub study_id: String,
    /// false: sections only (the safe default). true: also blocks, findings
    /// and study passages. Scripture annotations are never copied.
    #[serde(default)]
    pub include_content: bool,
}

// ---------------------------------------------------------------------------
// Sections and blocks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudySection {
    pub study_id: String,
    pub title: String,
    #[serde(default)]
    pub guidance: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteStudySection {
    pub id: String,
    /// Required when the section still has text or findings.
    #[serde(default)]
    pub force: bool,
}

/// New order for the children of one parent (a study's sections, a
/// section's blocks, a study's findings). Must list exactly the live ones.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reorder {
    pub parent_id: String,
    pub ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FindingPassage {
    pub id: String,
    pub reference: ScriptureRefDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub study_id: String,
    pub section_id: Option<String>,
    pub finding_type: FindingType,
    pub content: String,
    pub sort_order: i64,
    pub parent_id: Option<String>,
    pub passages: Vec<FindingPassage>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFinding {
    pub study_id: String,
    pub finding_type: FindingType,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub section_id: Option<String>,
    /// Canonical reference to link at once, if the user chose to.
    #[serde(default)]
    pub passage: Option<String>,
}

/// Fields left out are unchanged. `section_id: ""` makes the finding
/// study-level again.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateFinding {
    pub id: String,
    pub finding_type: Option<FindingType>,
    pub content: Option<String>,
    pub section_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkFindingPassage {
    pub finding_id: String,
    pub reference: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFindingTags {
    pub finding_id: String,
    pub tags: Vec<String>,
}

// ---------------------------------------------------------------------------
// Relations between studies
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelatedStudy {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub study_type: StudyType,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudyRelation {
    pub id: String,
    pub relation_type: RelationType,
    /// "outgoing": this study → other; "incoming": other → this study.
    pub direction: &'static str,
    pub note: Option<String>,
    pub other: RelatedStudy,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyRelation {
    pub from_study_id: String,
    pub to_study_id: String,
    pub relation_type: RelationType,
    #[serde(default)]
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// Study search
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudySearchHit {
    pub study_id: String,
    pub study_title: String,
    pub project_id: String,
    /// "study", "section", "block" or "finding".
    pub kind: String,
    /// Where it matched, in plain words: "Title", "Section: Context",
    /// "Observations", "Finding: Question".
    pub location: String,
    /// Matching text with matches wrapped in U+0002 … U+0003.
    pub snippet: String,
}
