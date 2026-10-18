//! Church presentation templates (v0.18.1): a reusable design — slide size,
//! colours, fonts, background, logo, footer and a layout per kind of slide —
//! that a presentation chooses. One definition feeds the audience screen,
//! PowerPoint and PDF. A template never holds sermon content and never
//! changes a teaching; a presentation that chooses another template keeps
//! its slides exactly.
//!
//! Positions and sizes are in points on the template's page (960 × 540 for
//! 16:9, 720 × 540 for 4:3), so every output places things the same way.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, UserMessage};

pub const FORMAT: &str = "abiding-word/presentation-template";
pub const VERSION: u32 = 1;

/// The kinds of slide a template can lay out. A kind of slide without its
/// own layout uses `custom`, and without that the built-in arrangement in
/// the template's colours and fonts.
pub const ROLES: &[&str] = &[
    "title",
    "section",
    "heading",
    "scripture",
    "quote",
    "question",
    "image",
    "text",
    "pause",
    "custom",
];

/// The role a kind of slide takes.
pub fn role_for_kind(kind: &str) -> &'static str {
    match kind {
        "title" => "title",
        "section" => "section",
        "heading" => "heading",
        "scripture" => "scripture",
        "quote" => "quote",
        "question" => "question",
        "image" => "image",
        "text" => "text",
        "pause" => "pause",
        _ => "custom",
    }
}

/// Page sizes in points: 16:9 and 4:3 (PowerPoint's standard widescreen and
/// standard sizes, scaled so the height is 540).
pub const WIDE: (f32, f32) = (960.0, 540.0);
pub const STANDARD: (f32, f32) = (720.0, 540.0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateDefinition {
    pub format: String,
    pub version: u32,
    /// The page, in points.
    pub width: f32,
    pub height: f32,
    pub colors: TemplateColors,
    pub fonts: TemplateFonts,
    pub background: Background,
    pub logo: Option<Placed>,
    pub footer: Option<Footer>,
    /// Layouts by role (see [`ROLES`]); none is required.
    pub roles: BTreeMap<String, RoleLayout>,
    /// The images the template uses, kept in the app's own data folder.
    pub assets: Vec<TemplateAsset>,
}

impl Default for TemplateDefinition {
    fn default() -> Self {
        TemplateDefinition {
            format: FORMAT.to_string(),
            version: VERSION,
            width: WIDE.0,
            height: WIDE.1,
            colors: TemplateColors::default(),
            fonts: TemplateFonts::default(),
            background: Background::default(),
            logo: None,
            footer: None,
            roles: BTreeMap::new(),
            assets: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateColors {
    pub background: String,
    pub text: String,
    pub muted: String,
    pub accent: String,
}

impl Default for TemplateColors {
    fn default() -> Self {
        let p = super::layout::palette("light");
        TemplateColors {
            background: p.background,
            text: p.text,
            muted: p.muted,
            accent: p.accent,
        }
    }
}

/// The two fonts of a template.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateFonts {
    pub heading: FontChoice,
    pub body: FontChoice,
    /// Other fonts a layout names for one of its boxes, each with its own
    /// replacement when it is not installed.
    pub others: Vec<FontChoice>,
}

/// A font as the template names it, and the installed font the person chose
/// instead when that one is not on this computer. An empty family means the
/// app's usual font.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FontChoice {
    pub family: String,
    pub replacement: Option<String>,
}

impl FontChoice {
    /// The family actually used everywhere: the replacement when one was chosen.
    pub fn resolved(&self) -> &str {
        self.replacement
            .as_deref()
            .filter(|r| !r.trim().is_empty())
            .unwrap_or(&self.family)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Background {
    /// A colour; the template's background colour when absent.
    pub color: Option<String>,
    pub image: Option<ImageFill>,
}

/// An image filling the whole page, as cropped in the source.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageFill {
    pub asset_id: String,
    pub crop: Crop,
}

/// How much is cut from each side of an image, as a share of its size (0–1).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

impl Crop {
    pub fn is_none(&self) -> bool {
        self.left == 0.0 && self.top == 0.0 && self.right == 0.0 && self.bottom == 0.0
    }
}

/// An image placed on the page (a logo, a decoration), stretched to its box
/// after cropping, as PowerPoint draws a picture.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Placed {
    pub asset_id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub crop: Crop,
    /// 0 (invisible) to 1 (opaque).
    pub opacity: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Footer {
    pub text: String,
    pub frame: TextFrame,
}

/// Where one kind of slide puts its parts. Each part is optional; a slide
/// whose content needs a part the layout lacks uses the fallback.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RoleLayout {
    /// The source layout this came from ("Bible Verse"), for the person.
    pub source: Option<String>,
    pub background: Option<Background>,
    /// Pictures that belong to the design (shapes kept as images, logos).
    pub decorations: Vec<Placed>,
    pub rects: Vec<FilledRect>,
    /// Text that belongs to the design (a church name in a band).
    pub labels: Vec<Footer>,
    /// The heading, the passage line (or a quotation's author), the text.
    pub title: Option<TextFrame>,
    pub reference: Option<TextFrame>,
    pub body: Option<TextFrame>,
    pub image: Option<Frame>,
    pub hide_logo: bool,
    pub hide_footer: bool,
}

/// A plain filled rectangle (a coloured band), with an optional outline.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FilledRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub fill: Option<String>,
    /// 0 (invisible) to 1 (opaque).
    pub fill_opacity: Option<f32>,
    pub line: Option<String>,
    /// Outline width in points.
    pub line_width: f32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Frame {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// A text box: where, which font, how big, how text sits in it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TextFrame {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// "heading" or "body" (the template's two fonts), or another family
    /// listed in `fonts.others`.
    pub font: String,
    /// The size text is set in (points).
    pub size: f32,
    /// With `fit: "shrink"`: the smallest size long text may shrink to.
    pub min_size: f32,
    pub bold: bool,
    pub italic: bool,
    /// "text", "muted", "accent" or a colour ("#1A2B3C").
    pub color: String,
    /// "left", "center" or "right".
    pub align: String,
    /// "top", "middle" or "bottom".
    pub valign: String,
    /// Inner margins: left, top, right, bottom (points).
    pub inset: [f32; 4],
    /// Line height as a multiple of the size.
    pub line_spacing: f32,
    /// "shrink": long text gets smaller down to `min_size` (only where the
    /// template says so); "none": the size stays and overflow is reported.
    pub fit: String,
}

impl Default for TextFrame {
    fn default() -> Self {
        TextFrame {
            x: 64.0,
            y: 64.0,
            w: 832.0,
            h: 100.0,
            font: "body".into(),
            size: 32.0,
            min_size: super::layout::MIN_TEXT,
            bold: false,
            italic: false,
            color: "text".into(),
            align: "left".into(),
            valign: "top".into(),
            inset: [7.2, 3.6, 7.2, 3.6],
            line_spacing: super::layout::LINE,
            fit: "shrink".into(),
        }
    }
}

impl TextFrame {
    /// The room for text inside the margins.
    pub fn inner(&self) -> (f32, f32, f32, f32) {
        let [l, t, r, b] = self.inset;
        (
            self.x + l,
            self.y + t,
            (self.w - l - r).max(1.0),
            (self.h - t - b).max(1.0),
        )
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct TemplateAsset {
    /// The image's SHA-256: the same image is kept once.
    pub id: String,
    pub media_type: String,
    pub width: u32,
    pub height: u32,
    /// Where it came from ("ppt/media/image3.png", "logo.png").
    pub name: String,
}

/// A built-in template: one of the three backgrounds, laid out as before.
pub fn builtin(theme: &str) -> TemplateDefinition {
    let p = super::layout::palette(theme);
    TemplateDefinition {
        colors: TemplateColors {
            background: p.background,
            text: p.text,
            muted: p.muted,
            accent: p.accent,
        },
        ..TemplateDefinition::default()
    }
}

impl TemplateDefinition {
    /// The layout a kind of slide uses: its own, else `custom`, else none
    /// (the built-in arrangement).
    pub fn layout_for(&self, kind: &str) -> Option<&RoleLayout> {
        let role = role_for_kind(kind);
        self.roles.get(role).or_else(|| {
            // A pause stays a plain background unless the template designs it.
            (role != "pause")
                .then(|| self.roles.get("custom"))
                .flatten()
        })
    }

    pub fn color(&self, name: &str) -> String {
        match name {
            "text" => self.colors.text.clone(),
            "muted" => self.colors.muted.clone(),
            "accent" => self.colors.accent.clone(),
            hex if is_hex(hex) => hex.to_string(),
            _ => self.colors.text.clone(),
        }
    }

    /// The installed family a frame's text is set in ("" for the app's usual font).
    pub fn family<'a>(&'a self, font: &'a str) -> &'a str {
        match font {
            "heading" => self.fonts.heading.resolved(),
            "body" | "" => self.fonts.body.resolved(),
            other => self
                .fonts
                .others
                .iter()
                .find(|f| f.family.eq_ignore_ascii_case(other))
                .map_or(other, FontChoice::resolved),
        }
    }

    /// Every family the design uses (resolved), without repeats.
    pub fn families(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for f in [&self.fonts.heading, &self.fonts.body]
            .into_iter()
            .chain(self.fonts.others.iter())
        {
            let name = f.resolved();
            if !name.trim().is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(name)) {
                out.push(name);
            }
        }
        out
    }

    /// Every image the template refers to.
    pub fn used_assets(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        fn add<'a>(out: &mut Vec<&'a str>, id: &'a str) {
            if !id.is_empty() && !out.contains(&id) {
                out.push(id);
            }
        }
        if let Some(i) = &self.background.image {
            add(&mut out, &i.asset_id);
        }
        if let Some(l) = &self.logo {
            add(&mut out, &l.asset_id);
        }
        for layout in self.roles.values() {
            if let Some(i) = layout.background.as_ref().and_then(|b| b.image.as_ref()) {
                add(&mut out, &i.asset_id);
            }
            for d in &layout.decorations {
                add(&mut out, &d.asset_id);
            }
        }
        out
    }
}

pub fn is_hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn invalid(text: impl Into<String>) -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "presentation.templateInvalid",
        text.into(),
    ))
}

/// Checks a definition before it is kept: known roles, sizes on the page,
/// real colours, images it has.
pub fn validate(def: &TemplateDefinition) -> AppResult<()> {
    if def.format != FORMAT || def.version > VERSION {
        return Err(invalid("This template was made by a newer version."));
    }
    if !(100.0..=4000.0).contains(&def.width) || !(100.0..=4000.0).contains(&def.height) {
        return Err(invalid("The slide size is not usable."));
    }
    for c in [
        &def.colors.background,
        &def.colors.text,
        &def.colors.muted,
        &def.colors.accent,
    ] {
        if !is_hex(c) {
            return Err(invalid(format!("“{c}” is not a colour.")));
        }
    }
    let known: Vec<&str> = def.assets.iter().map(|a| a.id.as_str()).collect();
    for id in def.used_assets() {
        if !known.contains(&id) {
            return Err(invalid("The template refers to an image it does not have."));
        }
    }
    for (role, layout) in &def.roles {
        if !ROLES.contains(&role.as_str()) {
            return Err(invalid(format!("“{role}” is not a kind of slide.")));
        }
        for frame in [&layout.title, &layout.reference, &layout.body]
            .into_iter()
            .flatten()
            .chain(layout.labels.iter().map(|l| &l.frame))
        {
            check_frame(def, frame)?;
        }
    }
    if let Some(f) = &def.footer {
        check_frame(def, &f.frame)?;
    }
    Ok(())
}

fn check_frame(def: &TemplateDefinition, f: &TextFrame) -> AppResult<()> {
    let on_page = f.w > 0.0
        && f.h > 0.0
        && f.x > -def.width
        && f.y > -def.height
        && f.x < def.width * 2.0
        && f.y < def.height * 2.0;
    // The smallest size only matters where text may shrink.
    if !on_page || !(4.0..=400.0).contains(&f.size) || (f.fit == "shrink" && f.min_size > f.size) {
        return Err(invalid("A text box of the template is not usable."));
    }
    if !(f.color == "text" || f.color == "muted" || f.color == "accent" || is_hex(&f.color)) {
        return Err(invalid(format!("“{}” is not a colour.", f.color)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_fall_back_to_custom_but_a_pause_stays_plain() {
        let mut def = builtin("warm");
        assert!(def.layout_for("heading").is_none());
        def.roles.insert("custom".into(), RoleLayout::default());
        assert!(def.layout_for("activity").is_some());
        assert!(def.layout_for("heading").is_some());
        assert!(def.layout_for("pause").is_none());
        assert_eq!(def.colors.background, "#F6F1E6");
        validate(&def).unwrap();
    }

    #[test]
    fn a_replacement_font_is_used_when_chosen() {
        let mut f = FontChoice {
            family: "Montserrat SemiBold".into(),
            replacement: None,
        };
        assert_eq!(f.resolved(), "Montserrat SemiBold");
        f.replacement = Some("Arial".into());
        assert_eq!(f.resolved(), "Arial");
    }

    #[test]
    fn broken_definitions_are_refused() {
        let mut def = builtin("light");
        def.roles.insert("banner".into(), RoleLayout::default());
        assert!(validate(&def).is_err());
        let mut def = builtin("light");
        def.logo = Some(Placed {
            asset_id: "missing".into(),
            ..Default::default()
        });
        assert!(validate(&def).is_err());
        let mut def = builtin("light");
        def.colors.text = "red".into();
        assert!(validate(&def).is_err());
    }
}
