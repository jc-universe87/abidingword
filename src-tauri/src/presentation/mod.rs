//! Presentation & Delivery (v0.18). One pipeline:
//!
//! ```text
//! Teaching ─▶ presentation (db::presentations) ─▶ PresentationDocument ─┬▶ Presenter View / audience screen
//!                                                                        ├▶ PowerPoint (pptx)
//!                                                                        ├▶ PDF (slides, speaker sheet)
//!                                                                        ├▶ Markdown
//!                                                                        └▶ delivery package (JSON)
//! ```
//!
//! Every output is made from the same [`document::PresentationDocument`];
//! no renderer reads the teaching or the database itself.

pub mod document;
pub mod fonts;
pub mod images;
pub mod layout;
pub mod locale;
pub mod markdown;
pub mod package;
pub mod pdf;
pub mod pptx;
pub mod text;

use serde::{Deserialize, Serialize};

pub use document::{build, AudienceDocument, PresentationDocument};
pub use images::ImageStore;
pub use locale::ExportLocale;

/// What an export includes besides the audience's slides.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportOptions {
    /// The speaker's manuscript and notes (PowerPoint notes pages, Markdown).
    pub speaker_notes: bool,
    /// Where stories, images and the Bible text come from.
    pub citations: bool,
    pub locale: ExportLocale,
}

/// What the audience screen shows now. Only audience content can be put
/// in it: a slide by its place, a pause, or a passage the speaker chose to
/// show for a moment. Speaker text has no field here.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AudienceState {
    pub presentation_id: String,
    pub index: usize,
    pub blank: bool,
    pub scripture: Option<ScriptureOverlay>,
}

/// A passage shown on the audience screen over the slide, without losing
/// the place in the presentation.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptureOverlay {
    /// The passage as the reader sees it ("John 15:5").
    pub label: String,
    pub bible: Option<String>,
    pub verses: Vec<document::SlideVerse>,
}
