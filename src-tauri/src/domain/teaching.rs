//! Teaching Preparation (v0.16): what a study leads to — a sermon, a group
//! study, a lesson — written by the person, reusing the study's findings and
//! naming Scripture. The TypeScript mirror is `src/types/teaching.ts`.

use serde::{Deserialize, Serialize};

use crate::domain::Finding;
use crate::scripture::reference::ScriptureRefDto;

/// The kinds of teaching a preparation can be for. A hint for wording and
/// the assistant, never a fixed structure.
pub const TEACHING_KINDS: &[&str] = &[
    "sermon",
    "bible_study",
    "youth",
    "children",
    "lesson",
    "talk",
    "other",
];

/// The kinds of step a lesson can be made of. Audio is accepted for the
/// future (a step with a recording), not yet offered in the interface.
pub const STEP_KINDS: &[&str] = &[
    "text",
    "scripture",
    "question",
    "activity",
    "image",
    "audio",
];

/// What the person kept from the assistant.
pub const MATERIAL_KINDS: &[&str] = &["story", "illustration", "image", "visual"];

/// How far a kept item can be relied on. Always shown with it.
/// * `verified`: a real event or quotation supported by at least two
///   independent sources the search actually returned;
/// * `unverified`: offered as real, but not supported well enough;
/// * `hypothetical`: an invented illustration, never presented as fact;
/// * `found`: an image found with its source and licence;
/// * `generated`: an image made by an image generator, never a photograph;
/// * `suggestion`: an idea (e.g. a visual) from the assistant's own reasoning.
pub const MATERIAL_STANDINGS: &[&str] = &[
    "verified",
    "unverified",
    "hypothetical",
    "found",
    "generated",
    "suggestion",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeachingSummary {
    pub id: String,
    pub study_id: String,
    pub title: String,
    pub kind: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeachingPreparation {
    pub id: String,
    pub study_id: String,
    pub title: String,
    pub kind: Option<String>,
    pub audience: Option<String>,
    pub purpose: Option<String>,
    pub central_message: Option<String>,
    pub introduction: String,
    pub conclusion: String,
    pub notes: String,
    pub points: Vec<TeachingPoint>,
    /// Study findings used here (live: always the finding as it is now).
    pub findings: Vec<TeachingFindingLink>,
    pub passages: Vec<TeachingPassage>,
    pub materials: Vec<TeachingMaterial>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeachingPoint {
    pub id: String,
    pub position: i64,
    /// For a step of a lesson: what kind of step it is (see [`STEP_KINDS`]).
    pub kind: Option<String>,
    pub title: String,
    pub explanation: String,
    pub application: String,
    pub illustration: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeachingFindingLink {
    pub id: String,
    /// The point it is used under; `None` for the preparation as a whole.
    pub point_id: Option<String>,
    pub finding: Finding,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeachingPassage {
    pub id: String,
    pub point_id: Option<String>,
    pub reference: ScriptureRefDto,
}

/// A source the assistant was given by a search (never one it wrote).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ExternalSource {
    pub title: String,
    pub url: String,
    pub site: String,
    pub excerpt: String,
}

/// An image's provenance: where it was found and under which licence, or
/// that it was generated (then `file` is where it was saved).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageInfo {
    pub url: Option<String>,
    pub page_url: Option<String>,
    pub thumb_url: Option<String>,
    pub licence: Option<String>,
    pub licence_url: Option<String>,
    pub author: Option<String>,
    pub attribution: Option<String>,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeachingMaterial {
    pub id: String,
    pub point_id: Option<String>,
    pub kind: String,
    pub standing: String,
    pub title: String,
    pub content: String,
    pub sources: Vec<ExternalSource>,
    pub image: Option<ImageInfo>,
    /// Which assistant produced it, e.g. "OpenAI · gpt-4.1".
    pub assistant: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeaching {
    pub study_id: String,
    pub title: String,
    #[serde(default)]
    pub kind: Option<String>,
    /// The steps or points it starts with (a format's starting structure),
    /// named in the person's language by the interface.
    #[serde(default)]
    pub points: Vec<StartingPoint>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StartingPoint {
    pub title: String,
    pub kind: Option<String>,
}

/// Each field: `None` leaves it as it is; `Some("")` clears an optional one.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateTeaching {
    pub id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub audience: Option<String>,
    pub purpose: Option<String>,
    pub central_message: Option<String>,
    pub introduction: Option<String>,
    pub conclusion: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateTeachingPoint {
    pub preparation_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    /// Put the new point straight after this one; at the end when absent.
    pub after_point_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateTeachingPoint {
    pub id: String,
    /// `Some("")` clears it.
    pub kind: Option<String>,
    pub title: Option<String>,
    pub explanation: Option<String>,
    pub application: Option<String>,
    pub illustration: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LinkTeachingFinding {
    pub preparation_id: String,
    pub point_id: Option<String>,
    pub finding_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AddTeachingPassage {
    pub preparation_id: String,
    pub point_id: Option<String>,
    /// Canonical reference, e.g. "JHN.15.1-JHN.15.8".
    pub reference: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KeepTeachingMaterial {
    pub preparation_id: String,
    pub point_id: Option<String>,
    pub kind: String,
    pub standing: String,
    pub title: String,
    pub content: String,
    pub sources: Vec<ExternalSource>,
    pub image: Option<ImageInfo>,
    pub assistant: Option<String>,
}
