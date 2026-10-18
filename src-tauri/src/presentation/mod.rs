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
pub mod font_catalog;
pub mod fonts;
pub mod images;
pub mod layout;
pub mod locale;
pub mod markdown;
pub mod package;
pub mod pdf;
pub mod pptx;
pub mod template;
pub mod template_store;
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
    /// The speaker's pointer and pen on the slide, for this moment only.
    pub marks: LiveMarks,
    /// Counts up with each change from the Presenter View, so a change that
    /// arrives late never replaces a newer one.
    pub seq: u64,
}

impl AudienceState {
    /// Whether this change may replace what is kept: not when it is an older
    /// change of the same presentation that arrived late.
    pub fn replaces(&self, kept: Option<&AudienceState>) -> bool {
        kept.is_none_or(|k| k.presentation_id != self.presentation_id || self.seq >= k.seq)
    }
}

/// Temporary marks on the audience slide: where the pointer is and the pen
/// strokes, in slide coordinates from 0 to 1. Never stored, never exported.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveMarks {
    pub pointer: Option<[f32; 2]>,
    pub strokes: Vec<Vec<[f32; 2]>>,
}

impl LiveMarks {
    /// At most this many strokes of this many points reach the audience screen.
    pub const STROKES_MAX: usize = 50;
    pub const POINTS_MAX: usize = 500;

    /// Keeps the marks small and on the slide.
    pub fn bounded(mut self) -> Self {
        let clamp = |[x, y]: [f32; 2]| [x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)];
        self.pointer = self
            .pointer
            .filter(|p| p.iter().all(|v| v.is_finite()))
            .map(clamp);
        self.strokes.truncate(Self::STROKES_MAX);
        for stroke in &mut self.strokes {
            stroke.retain(|p| p.iter().all(|v| v.is_finite()));
            stroke.truncate(Self::POINTS_MAX);
            for p in stroke.iter_mut() {
                *p = clamp(*p);
            }
        }
        self
    }
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
