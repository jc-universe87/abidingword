//! Where things go on an audience slide: one layout, in points on the
//! design's page (960 × 540 for 16:9), used by both the PDF and the
//! PowerPoint export so the two show the same slide (the audience screen
//! reads the same template geometry). A church template (v0.18.1) places
//! text in its own boxes; a kind of slide the template does not lay out,
//! and the built-in backgrounds, use the arrangement below in the design's
//! colours and fonts. Text shrinks to fit only where the design says so; a
//! long passage has already been split over several slides.

use serde::{Deserialize, Serialize};

use super::document::{PresentationDocument, Slide};
use super::template::{self, Crop, RoleLayout, TemplateDefinition, TextFrame};
use super::text::Shaper;
use super::ExportLocale;

pub const WIDTH: f32 = 960.0;
pub const HEIGHT: f32 = 540.0;
const MARGIN: f32 = 64.0;
/// The smallest size audience text is set in (credits: [`CREDIT_SIZE`]).
pub const MIN_TEXT: f32 = 22.0;
pub const CREDIT_SIZE: f32 = 16.0;
pub const LINE: f32 = 1.25;

/// The colours of a theme, shared with the interface
/// (`resources/presentation/themes.json`).
#[derive(Debug, Clone, Deserialize)]
pub struct Palette {
    pub background: String,
    pub text: String,
    pub muted: String,
    pub accent: String,
}

pub fn palette(theme: &str) -> Palette {
    let all: std::collections::BTreeMap<String, Palette> =
        serde_json::from_str(include_str!("../../../resources/presentation/themes.json"))
            .unwrap_or_default();
    all.get(theme)
        .or_else(|| all.get("light"))
        .cloned()
        .unwrap_or(Palette {
            background: "#FFFFFF".into(),
            text: "#1D1B18".into(),
            muted: "#55504A".into(),
            accent: "#2F5D50".into(),
        })
}

/// A colour as red, green, blue from 0 to 1.
pub fn rgb(hex: &str) -> (f32, f32, f32) {
    let v = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0);
    let c = |shift: u32| ((v >> shift) & 0xFF) as f32 / 255.0;
    (c(16), c(8), c(0))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Text,
    Muted,
    Accent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    Left,
    Center,
    Right,
}

impl Align {
    fn of(name: &str) -> Align {
        match name {
            "center" => Align::Center,
            "right" => Align::Right,
            _ => Align::Left,
        }
    }
}

/// A template's text box, as PowerPoint should hold it (it places the text
/// in it itself; the PDF uses the lines worked out here).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub inset: [f32; 4],
    /// "top", "middle" or "bottom".
    pub valign: String,
    pub shrink: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub size: f32,
    pub bold: bool,
    pub italic: bool,
    /// The colour (hex).
    pub color: String,
    /// The installed family it is set in; none: the usual fonts.
    pub family: Option<String>,
    pub align: Align,
    /// Line height as a multiple of the size.
    pub line: f32,
    /// Paragraphs as written (PowerPoint wraps them itself).
    pub paragraphs: Vec<String>,
    /// The same text wrapped to the box (for the PDF).
    pub lines: Vec<String>,
    /// The template box it fills, when it fills one.
    pub frame: Option<FrameBox>,
    /// The text does not fit its box at this size.
    pub overflow: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBox {
    pub asset_id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// A template's picture: cropped as in the source, stretched to its box.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picture {
    pub asset_id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub crop: Crop,
    pub opacity: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RectBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub fill: Option<String>,
    pub fill_opacity: f32,
    pub line: Option<String>,
    pub line_width: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    Text(TextBox),
    Image(ImageBox),
    Picture(Picture),
    Rect(RectBox),
    /// An image that cannot be shown here: a framed note instead.
    Missing {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    },
}

/// One laid-out audience page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub width: f32,
    pub height: f32,
    pub background: String,
    pub blocks: Vec<Block>,
}

impl Page {
    /// Text boxes whose text does not fit at the template's size.
    pub fn overflowing(&self) -> usize {
        self.blocks
            .iter()
            .filter(|b| matches!(b, Block::Text(t) if t.overflow))
            .count()
    }
}

struct Fit<'a> {
    shaper: &'a Shaper<'a>,
    design: &'a TemplateDefinition,
}

impl Fit<'_> {
    fn family(&self, bold: bool) -> Option<String> {
        let f = self.design.family(if bold { "heading" } else { "body" });
        (!f.trim().is_empty()).then(|| f.to_string())
    }

    fn color(&self, role: Role) -> String {
        match role {
            Role::Text => self.design.colors.text.clone(),
            Role::Muted => self.design.colors.muted.clone(),
            Role::Accent => self.design.colors.accent.clone(),
        }
    }

    /// The largest size from `max` down to `min` at which the text fits the
    /// box; the minimum when nothing does.
    #[allow(clippy::too_many_arguments)]
    fn size(
        &self,
        text: &str,
        bold: bool,
        family: Option<&str>,
        w: f32,
        h: f32,
        (max, min): (f32, f32),
        line: f32,
    ) -> (f32, Vec<String>) {
        let mut size = max;
        loop {
            let lines = self.shaper.wrap_in(text, bold, size, w, family);
            if lines.len() as f32 * size * line <= h || size <= min {
                return (size, lines);
            }
            size = (size - 2.0).max(min);
        }
    }

    /// A text in the built-in arrangement.
    #[allow(clippy::too_many_arguments)]
    fn text(
        &self,
        text: &str,
        (x, y, w, h): (f32, f32, f32, f32),
        (max, min): (f32, f32),
        bold: bool,
        role: Role,
        align: Align,
    ) -> TextBox {
        let family = self.family(bold);
        let (size, lines) = self.size(text, bold, family.as_deref(), w, h, (max, min), LINE);
        let used = (lines.len() as f32 * size * LINE).min(h.max(size * LINE));
        TextBox {
            x,
            y,
            w,
            h: used.max(size * LINE),
            size,
            bold,
            italic: false,
            color: self.color(role),
            family,
            align,
            line: LINE,
            paragraphs: text.split('\n').map(str::to_string).collect(),
            lines,
            frame: None,
            overflow: false,
        }
    }

    /// A text in one of the template's boxes.
    fn framed(&self, text: &str, f: &TextFrame) -> TextBox {
        let family = Some(self.design.family(&f.font).to_string()).filter(|s| !s.trim().is_empty());
        let (ix, iy, iw, ih) = f.inner();
        let line = if f.line_spacing > 0.0 {
            f.line_spacing
        } else {
            LINE
        };
        let shrink = f.fit == "shrink";
        let (size, lines) = if shrink {
            self.size(
                text,
                f.bold,
                family.as_deref(),
                iw,
                ih,
                (f.size, f.min_size.min(f.size)),
                line,
            )
        } else {
            (
                f.size,
                self.shaper
                    .wrap_in(text, f.bold, f.size, iw, family.as_deref()),
            )
        };
        let used = lines.len() as f32 * size * line;
        let overflow = used > ih + 0.5;
        let y = match f.valign.as_str() {
            "middle" if !overflow => iy + (ih - used) / 2.0,
            "bottom" if !overflow => iy + ih - used,
            _ => iy,
        };
        TextBox {
            x: ix,
            y,
            w: iw,
            h: used.max(size * line),
            size,
            bold: f.bold,
            italic: f.italic,
            color: self.design.color(&f.color),
            family,
            align: Align::of(&f.align),
            line,
            paragraphs: text.split('\n').map(str::to_string).collect(),
            lines,
            frame: Some(FrameBox {
                x: f.x,
                y: f.y,
                w: f.w,
                h: f.h,
                inset: f.inset,
                valign: f.valign.clone(),
                shrink,
            }),
            overflow,
        }
    }
}

/// The verses as one text: "5 I am the vine… 6 If anyone…".
pub fn verses_text(slide: &Slide) -> String {
    slide
        .audience
        .verses
        .iter()
        .map(|v| format!("{} {}", v.verse, v.text.trim()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The line naming a passage on a slide: "John 15:1–8 (BSB)".
pub fn reference_line(slide: &Slide, locale: &ExportLocale) -> Option<String> {
    if let Some(label) = slide.audience.reference_label.as_ref() {
        return Some(match &slide.audience.bible {
            Some(bible) if slide.kind == "scripture" => format!("{label} ({bible})"),
            _ => label.clone(),
        });
    }
    let r = slide.audience.reference.as_ref()?;
    let mut line = locale.reference(r);
    if slide.kind == "scripture" {
        if let Some(bible) = &slide.audience.bible {
            line.push_str(&format!(" ({bible})"));
        }
    }
    Some(line)
}

/// What a slide puts in a template's parts. The interface draws the pages
/// worked out here (`presentation_layout`), so it cannot differ.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Slots {
    pub title: Option<String>,
    pub reference: Option<String>,
    pub body: Option<String>,
    pub image: bool,
}

fn some(text: Option<&String>) -> Option<String> {
    text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

pub fn slots(slide: &Slide, locale: &ExportLocale) -> Slots {
    let a = &slide.audience;
    match slide.kind.as_str() {
        "pause" => Slots::default(),
        "scripture" => {
            let verses = verses_text(slide);
            let text = if verses.is_empty() {
                a.reference
                    .as_ref()
                    .map(|_| locale.labels.scripture_unavailable.clone())
            } else {
                Some(verses)
            };
            let body = match (text, some(a.body.as_ref())) {
                (Some(t), Some(b)) => Some(format!("{t}\n{b}")),
                (t, b) => t.or(b),
            };
            Slots {
                title: some(a.heading.as_ref()),
                reference: reference_line(slide, locale),
                body,
                image: false,
            }
        }
        "quote" => Slots {
            title: None,
            reference: some(a.heading.as_ref()).map(|h| format!("— {h}")),
            body: some(a.body.as_ref()).map(|b| format!("“{b}”")),
            image: false,
        },
        "image" => {
            let caption = a.image.as_ref().map(|image| {
                let mut c = image.caption.clone().unwrap_or_default();
                if image.generated {
                    let label = &locale.labels.generated_image;
                    c = if c.is_empty() {
                        label.clone()
                    } else {
                        format!("{c} · {label}")
                    };
                }
                if let Some(credit) = image.credit.as_ref().filter(|c| !c.is_empty()) {
                    c = if c.is_empty() {
                        credit.clone()
                    } else {
                        format!("{c}\n{credit}")
                    };
                }
                c
            });
            Slots {
                title: some(a.heading.as_ref()),
                reference: None,
                body: caption.filter(|c| !c.is_empty()),
                image: a.image.is_some(),
            }
        }
        kind => Slots {
            title: some(a.heading.as_ref()),
            // As in the built-in arrangement, only a title or section slide names its passage.
            reference: matches!(kind, "title" | "section")
                .then(|| reference_line(slide, locale))
                .flatten(),
            body: some(a.body.as_ref()),
            image: false,
        },
    }
}

/// Which box each part of a slide goes in. The passage line (or a
/// quotation's author) uses its own box, else the title box when the slide
/// has no heading, else the text box when it has no text: a church's
/// "Bible verse" layout often has just a title and a text box.
#[derive(Debug, Clone, Copy, Default)]
pub struct Placement<'a> {
    pub title: Option<&'a TextFrame>,
    pub reference: Option<&'a TextFrame>,
    pub body: Option<&'a TextFrame>,
}

pub fn place<'a>(layout: &'a RoleLayout, s: &Slots) -> Placement<'a> {
    let reference = layout
        .reference
        .as_ref()
        .or_else(|| s.title.is_none().then_some(layout.title.as_ref()).flatten())
        .or_else(|| s.body.is_none().then_some(layout.body.as_ref()).flatten());
    let same = |a: Option<&TextFrame>, b: Option<&TextFrame>| {
        a.is_some() && a.map(|x| x as *const _) == b.map(|x| x as *const _)
    };
    Placement {
        title: layout.title.as_ref().filter(|t| !same(Some(t), reference)),
        reference,
        body: layout.body.as_ref().filter(|b| !same(Some(b), reference)),
    }
}

/// Whether a template layout has a place for everything a slide shows; if
/// not, the slide uses the built-in arrangement so nothing is left out.
pub fn fits(layout: &RoleLayout, s: &Slots) -> bool {
    let p = place(layout, s);
    (s.title.is_none() || p.title.is_some())
        && (s.reference.is_none() || p.reference.is_some())
        && (s.body.is_none() || p.body.is_some())
        && (!s.image || layout.image.is_some())
}

fn picture(p: &template::Placed) -> Block {
    Block::Picture(Picture {
        asset_id: p.asset_id.clone(),
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        crop: p.crop,
        opacity: p.opacity.unwrap_or(1.0).clamp(0.0, 1.0),
    })
}

/// The image of an image slide, as large as its box allows.
fn slide_image(
    slide: &Slide,
    doc: &PresentationDocument,
    (x, y, w, h): (f32, f32, f32, f32),
) -> Option<Block> {
    let image = slide.audience.image.as_ref()?;
    let asset = doc.images.iter().find(|i| i.id == image.asset_id);
    Some(
        match asset
            .filter(|i| i.available)
            .and_then(|i| Some((i, i.width?, i.height?)))
        {
            Some((asset, iw, ih)) => {
                let scale = (w / iw as f32).min(h / ih as f32);
                let (dw, dh) = (iw as f32 * scale, ih as f32 * scale);
                Block::Image(ImageBox {
                    asset_id: asset.id.clone(),
                    x: x + (w - dw) / 2.0,
                    y: y + (h - dh) / 2.0,
                    w: dw,
                    h: dh,
                })
            }
            None => Block::Missing { x, y, w, h },
        },
    )
}

/// One audience page in a design: the background, the design's pictures and
/// bands, the slide's content, then the logo and footer.
pub fn page(
    slide: &Slide,
    doc: &PresentationDocument,
    design: &TemplateDefinition,
    shaper: &Shaper,
    locale: &ExportLocale,
) -> Page {
    let fit = Fit { shaper, design };
    let layout = design.layout_for(&slide.kind);
    let background = layout
        .and_then(|l| l.background.as_ref())
        .unwrap_or(&design.background);
    let mut blocks = Vec::new();
    if let Some(fill) = &background.image {
        blocks.push(Block::Picture(Picture {
            asset_id: fill.asset_id.clone(),
            x: 0.0,
            y: 0.0,
            w: design.width,
            h: design.height,
            crop: fill.crop,
            opacity: 1.0,
        }));
    }
    if let Some(l) = layout {
        for r in &l.rects {
            blocks.push(Block::Rect(RectBox {
                x: r.x,
                y: r.y,
                w: r.w,
                h: r.h,
                fill: r.fill.clone(),
                fill_opacity: r.fill_opacity.unwrap_or(1.0).clamp(0.0, 1.0),
                line: r.line.clone(),
                line_width: r.line_width,
            }));
        }
        blocks.extend(l.decorations.iter().map(picture));
        for label in l.labels.iter().filter(|t| !t.text.trim().is_empty()) {
            blocks.push(Block::Text(fit.framed(label.text.trim(), &label.frame)));
        }
    }
    let blank = slide.audience.blank || slide.kind == "pause";
    if !blank {
        let s = slots(slide, locale);
        match layout.filter(|l| fits(l, &s)) {
            Some(l) => {
                let p = place(l, &s);
                if let (Some(t), Some(f)) = (&s.title, p.title) {
                    blocks.push(Block::Text(fit.framed(t, f)));
                }
                if let (Some(t), Some(f)) = (&s.reference, p.reference) {
                    blocks.push(Block::Text(fit.framed(t, f)));
                }
                if let (Some(t), Some(f)) = (&s.body, p.body) {
                    blocks.push(Block::Text(fit.framed(t, f)));
                }
                if let (true, Some(f)) = (s.image, &l.image) {
                    blocks.extend(slide_image(slide, doc, (f.x, f.y, f.w, f.h)));
                }
            }
            None => blocks.extend(flow(slide, doc, &fit, locale, design.width, design.height)),
        }
    }
    if !blank {
        if let Some(logo) = design
            .logo
            .as_ref()
            .filter(|_| !layout.is_some_and(|l| l.hide_logo))
        {
            blocks.push(picture(logo));
        }
        if let Some(footer) = design
            .footer
            .as_ref()
            .filter(|f| !f.text.trim().is_empty() && !layout.is_some_and(|l| l.hide_footer))
        {
            blocks.push(Block::Text(fit.framed(footer.text.trim(), &footer.frame)));
        }
    }
    Page {
        width: design.width,
        height: design.height,
        background: background
            .color
            .clone()
            .filter(|c| template::is_hex(c))
            .unwrap_or_else(|| design.colors.background.clone()),
        blocks,
    }
}

/// The blocks of one audience slide in the built-in design of the
/// document's background (as before templates).
pub fn slide(
    slide: &Slide,
    doc: &PresentationDocument,
    shaper: &Shaper,
    locale: &ExportLocale,
) -> Vec<Block> {
    page(slide, doc, &doc.design(), shaper, locale).blocks
}

/// The built-in arrangement, top to bottom, on a page of `width` × `height`.
fn flow(
    slide: &Slide,
    doc: &PresentationDocument,
    fit: &Fit,
    locale: &ExportLocale,
    width: f32,
    height: f32,
) -> Vec<Block> {
    let a = &slide.audience;
    let w = width - 2.0 * MARGIN;
    let mut blocks = Vec::new();
    let mut y = MARGIN;
    let bottom = height - MARGIN;
    let mut push = |b: TextBox, y: &mut f32, gap: f32| {
        *y = b.y + b.h + gap;
        blocks.push(Block::Text(b));
    };
    match slide.kind.as_str() {
        "title" | "section" => {
            // Centred, a little above the middle.
            let max = if slide.kind == "title" { 54.0 } else { 46.0 };
            let heading = a.heading.clone().unwrap_or_default();
            let mut parts: Vec<TextBox> = Vec::new();
            if !heading.is_empty() {
                parts.push(fit.text(
                    &heading,
                    (MARGIN, 0.0, w, 200.0),
                    (max, 32.0),
                    true,
                    Role::Text,
                    Align::Center,
                ));
            }
            if let Some(line) = reference_line(slide, locale) {
                parts.push(fit.text(
                    &line,
                    (MARGIN, 0.0, w, 60.0),
                    (28.0, MIN_TEXT),
                    false,
                    Role::Accent,
                    Align::Center,
                ));
            }
            if let Some(body) = &a.body {
                parts.push(fit.text(
                    body,
                    (MARGIN, 0.0, w, 140.0),
                    (26.0, MIN_TEXT),
                    false,
                    Role::Muted,
                    Align::Center,
                ));
            }
            let total: f32 = parts.iter().map(|p| p.h + 16.0).sum::<f32>() - 16.0;
            let mut y = ((height - total) / 2.0 - 20.0).max(MARGIN);
            for mut p in parts {
                p.y = y;
                push(p, &mut y, 16.0);
            }
        }
        "scripture" => {
            if let Some(heading) = &a.heading {
                push(
                    fit.text(
                        heading,
                        (MARGIN, y, w, 60.0),
                        (32.0, 26.0),
                        true,
                        Role::Text,
                        Align::Left,
                    ),
                    &mut y,
                    8.0,
                );
            }
            if let Some(line) = reference_line(slide, locale) {
                push(
                    fit.text(
                        &line,
                        (MARGIN, y, w, 44.0),
                        (28.0, MIN_TEXT),
                        true,
                        Role::Accent,
                        Align::Left,
                    ),
                    &mut y,
                    16.0,
                );
            }
            let verses = verses_text(slide);
            if !verses.is_empty() {
                let h = bottom - y;
                push(
                    fit.text(
                        &verses,
                        (MARGIN, y, w, h),
                        (34.0, MIN_TEXT),
                        false,
                        Role::Text,
                        Align::Left,
                    ),
                    &mut y,
                    12.0,
                );
            } else if a.reference.is_some() {
                push(
                    fit.text(
                        &locale.labels.scripture_unavailable,
                        (MARGIN, y, w, 40.0),
                        (24.0, MIN_TEXT),
                        false,
                        Role::Muted,
                        Align::Left,
                    ),
                    &mut y,
                    12.0,
                );
            }
            if let Some(body) = &a.body {
                let h = (bottom - y).max(MIN_TEXT * LINE);
                push(
                    fit.text(
                        body,
                        (MARGIN, y, w, h),
                        (26.0, MIN_TEXT),
                        false,
                        Role::Muted,
                        Align::Left,
                    ),
                    &mut y,
                    0.0,
                );
            }
        }
        "image" => {
            let mut caption_h = 0.0;
            let caption = a.image.as_ref().map(|image| {
                let mut c = image.caption.clone().unwrap_or_default();
                if image.generated {
                    let label = &locale.labels.generated_image;
                    c = if c.is_empty() {
                        label.clone()
                    } else {
                        format!("{c} · {label}")
                    };
                }
                c
            });
            let credit = a.image.as_ref().and_then(|i| i.credit.clone());
            let caption_box = caption.filter(|c| !c.is_empty()).map(|c| {
                fit.text(
                    &c,
                    (MARGIN, 0.0, w, 70.0),
                    (26.0, MIN_TEXT),
                    false,
                    Role::Text,
                    Align::Center,
                )
            });
            let credit_box = credit.map(|c| {
                fit.text(
                    &c,
                    (MARGIN, 0.0, w, 44.0),
                    (CREDIT_SIZE, CREDIT_SIZE),
                    false,
                    Role::Muted,
                    Align::Center,
                )
            });
            for b in caption_box.iter().chain(credit_box.iter()) {
                caption_h += b.h + 8.0;
            }
            let heading_box = a.heading.as_ref().map(|h| {
                fit.text(
                    h,
                    (MARGIN, MARGIN - 24.0, w, 56.0),
                    (32.0, 26.0),
                    true,
                    Role::Text,
                    Align::Center,
                )
            });
            let top = heading_box
                .as_ref()
                .map_or(MARGIN - 24.0, |h| h.y + h.h + 12.0);
            let area_h = (height - 32.0 - caption_h - top).max(120.0);
            if let Some(h) = heading_box {
                blocks.push(Block::Text(h));
            }
            blocks.extend(slide_image(slide, doc, (MARGIN, top, w, area_h)));
            let mut y = top + area_h + 8.0;
            for mut b in caption_box.into_iter().chain(credit_box) {
                b.y = y;
                y += b.h + 8.0;
                blocks.push(Block::Text(b));
            }
        }
        "question" => {
            if let Some(heading) = &a.heading {
                push(
                    fit.text(
                        heading,
                        (MARGIN, y, w, 50.0),
                        (28.0, MIN_TEXT),
                        true,
                        Role::Muted,
                        Align::Center,
                    ),
                    &mut y,
                    12.0,
                );
            }
            if let Some(body) = &a.body {
                let mut b = fit.text(
                    body,
                    (MARGIN, y, w, bottom - y),
                    (44.0, 26.0),
                    true,
                    Role::Text,
                    Align::Center,
                );
                b.y = (y + (bottom - y - b.h) / 2.0).max(y);
                push(b, &mut y, 0.0);
            }
        }
        "quote" => {
            if let Some(body) = &a.body {
                let quoted = format!("“{}”", body.trim());
                push(
                    fit.text(
                        &quoted,
                        (MARGIN + 24.0, y + 20.0, w - 48.0, bottom - y - 90.0),
                        (38.0, 24.0),
                        false,
                        Role::Text,
                        Align::Left,
                    ),
                    &mut y,
                    16.0,
                );
            }
            if let Some(heading) = &a.heading {
                push(
                    fit.text(
                        &format!("— {heading}"),
                        (MARGIN + 24.0, y, w - 48.0, 50.0),
                        (26.0, MIN_TEXT),
                        false,
                        Role::Muted,
                        Align::Left,
                    ),
                    &mut y,
                    0.0,
                );
            }
        }
        "text" if a.heading.is_none() => {
            // A text alone (such as the central message) stands in the middle.
            if let Some(body) = &a.body {
                let mut b = fit.text(
                    body,
                    (MARGIN, y, w, bottom - y),
                    (40.0, MIN_TEXT),
                    false,
                    Role::Text,
                    Align::Center,
                );
                b.y = (y + (bottom - y - b.h) / 2.0 - 20.0).max(y);
                push(b, &mut y, 0.0);
            }
        }
        _ => {
            // heading, text, activity
            let (heading_max, body_max) = match slide.kind.as_str() {
                "text" => (36.0, 34.0),
                _ => (44.0, 30.0),
            };
            if let Some(heading) = &a.heading {
                push(
                    fit.text(
                        heading,
                        (MARGIN, y, w, 120.0),
                        (heading_max, 30.0),
                        true,
                        Role::Text,
                        Align::Left,
                    ),
                    &mut y,
                    20.0,
                );
            }
            if let Some(body) = &a.body {
                push(
                    fit.text(
                        body,
                        (MARGIN, y, w, bottom - y),
                        (body_max, MIN_TEXT),
                        false,
                        Role::Text,
                        Align::Left,
                    ),
                    &mut y,
                    0.0,
                );
            }
        }
    }
    blocks
}
