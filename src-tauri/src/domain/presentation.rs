//! Presentation & Delivery (v0.18): how one Bible Teaching is delivered.
//! The teaching stays the source of truth; a presentation only says which of
//! its parts are shown, in which order, and what the audience sees apart
//! from what only the speaker sees. The TypeScript mirror is
//! `src/types/presentation.ts`; details in docs/presentation-delivery-v0.18.md.

use serde::{Deserialize, Serialize};

/// The three backgrounds a presentation can have.
pub const PRESENTATION_THEMES: &[&str] = &["light", "dark", "warm"];

/// The kinds of slide. Teaching-focused, not a general slide designer.
/// * `title`: the teaching's title (and its main passage);
/// * `section`: a section break between parts of the teaching;
/// * `heading`: a point or step, with an optional line for the audience;
/// * `text`: a short text for the audience;
/// * `scripture`: a passage, quoted from an installed Bible;
/// * `image`: a kept image, with its credit;
/// * `quote`: a quotation, with who said it;
/// * `question`: a question for the audience;
/// * `activity`: something the audience does;
/// * `pause`: a quiet, empty audience screen (the speaker keeps their notes).
pub const ITEM_KINDS: &[&str] = &[
    "title",
    "section",
    "heading",
    "text",
    "scripture",
    "image",
    "quote",
    "question",
    "activity",
    "pause",
];

/// The parts of a teaching a slide can follow.
pub const SOURCE_KINDS: &[&str] = &["preparation", "point", "passage", "material", "finding"];

/// The fields of the teaching itself a slide can follow.
pub const PREPARATION_FIELDS: &[&str] = &["title", "central_message", "introduction", "conclusion"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSummary {
    pub id: String,
    pub preparation_id: String,
    pub title: String,
    pub theme: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Presentation {
    pub id: String,
    pub preparation_id: String,
    pub title: String,
    pub theme: String,
    pub translation_id: Option<String>,
    /// An optional target time in minutes, for quiet guidance while presenting.
    pub target_minutes: Option<u32>,
    /// The church template it uses; none: the built-in background (`theme`).
    pub template_id: Option<String>,
    pub items: Vec<PresentationItem>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

/// The part of the teaching an item follows.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemSource {
    pub kind: String,
    pub id: String,
    /// For `preparation`: which field (see [`PREPARATION_FIELDS`]).
    pub field: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationItem {
    pub id: String,
    pub position: i64,
    pub kind: String,
    /// `None`: a slide of the presentation's own.
    pub source: Option<ItemSource>,
    /// The person's own heading; `None` follows the teaching.
    pub heading: Option<String>,
    /// The person's own audience text; `None` follows the teaching.
    pub body: Option<String>,
    /// A canonical reference; `None` follows the source passage.
    pub reference: Option<String>,
    /// Speaker-only notes. Never shown to the audience.
    pub notes: String,
    /// Left out of this presentation (kept to be brought back).
    pub skipped: bool,
}

/// Headings in the person's language for the slides a proposal starts
/// with; they become the person's own text.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProposalLabels {
    pub introduction: String,
    pub conclusion: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreatePresentation {
    pub preparation_id: String,
    /// The teaching's title when absent.
    pub title: Option<String>,
    /// Start from a proposal made from the teaching (deterministic, no AI);
    /// otherwise start with the title slide only.
    pub propose: bool,
    pub labels: ProposalLabels,
}

/// Each field: `None` leaves it as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePresentation {
    pub id: String,
    pub title: Option<String>,
    pub theme: Option<String>,
    /// `Some("")` goes back to the Scripture pane's Bible.
    pub translation_id: Option<String>,
    /// `Some(0)` removes the target time.
    pub target_minutes: Option<u32>,
    /// A template's id; `Some("")` goes back to the built-in background.
    pub template_id: Option<String>,
}

/// A church template as listed for choosing.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationTemplateSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub width: f32,
    pub height: f32,
    pub source_format: String,
    pub updated_at: String,
}

/// A church template with its whole design.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub definition: crate::presentation::template::TemplateDefinition,
    pub source_format: String,
    pub source_name: Option<String>,
    /// The compatibility report shown when it was imported.
    pub report: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreatePresentationTemplate {
    pub name: String,
    pub description: String,
    pub definition: crate::presentation::template::TemplateDefinition,
    /// pptx, package or designer.
    pub source_format: String,
    pub source_name: Option<String>,
    pub report: Option<serde_json::Value>,
}

/// Each field: `None` leaves it as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePresentationTemplate {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub definition: Option<crate::presentation::template::TemplateDefinition>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreatePresentationItem {
    pub presentation_id: String,
    pub kind: String,
    pub source: Option<ItemSource>,
    pub heading: Option<String>,
    pub body: Option<String>,
    pub reference: Option<String>,
    /// Put the new item straight after this one; at the end when absent.
    pub after_item_id: Option<String>,
}

/// Each field: `None` leaves it as it is. `follow_*` goes back to the
/// teaching's own wording (and wins over a value given with it).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePresentationItem {
    pub id: String,
    pub kind: Option<String>,
    pub heading: Option<String>,
    pub follow_heading: bool,
    pub body: Option<String>,
    pub follow_body: bool,
    pub reference: Option<String>,
    pub follow_reference: bool,
    pub notes: Option<String>,
    pub skipped: Option<bool>,
}
