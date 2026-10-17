//! Where things go on an audience slide: one layout, in points on a 16:9
//! page (960 × 540), used by both the PDF and the PowerPoint export so the
//! two show the same slide. Text is never set below a readable size; a
//! long passage has already been split over several slides.

use serde::Deserialize;

use super::document::{PresentationDocument, Slide};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextBox {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub size: f32,
    pub bold: bool,
    pub role: Role,
    pub align: Align,
    /// Paragraphs as written (PowerPoint wraps them itself).
    pub paragraphs: Vec<String>,
    /// The same text wrapped to the box (for the PDF).
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageBox {
    pub asset_id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Text(TextBox),
    Image(ImageBox),
    /// An image that cannot be shown here: a framed note instead.
    Missing {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    },
}

struct Fit<'a> {
    shaper: &'a Shaper<'a>,
}

impl Fit<'_> {
    /// The largest size from `max` down to `min` at which the text fits the
    /// box; the minimum when nothing does.
    fn size(
        &self,
        text: &str,
        bold: bool,
        w: f32,
        h: f32,
        max: f32,
        min: f32,
    ) -> (f32, Vec<String>) {
        let mut size = max;
        loop {
            let lines = self.shaper.wrap(text, bold, size, w);
            if lines.len() as f32 * size * LINE <= h || size <= min {
                return (size, lines);
            }
            size = (size - 2.0).max(min);
        }
    }

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
        let (size, lines) = self.size(text, bold, w, h, max, min);
        let used = (lines.len() as f32 * size * LINE).min(h.max(size * LINE));
        TextBox {
            x,
            y,
            w,
            h: used.max(size * LINE),
            size,
            bold,
            role,
            align,
            paragraphs: text.split('\n').map(str::to_string).collect(),
            lines,
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
    let r = slide.audience.reference.as_ref()?;
    let mut line = locale.reference(r);
    if slide.kind == "scripture" {
        if let Some(bible) = &slide.audience.bible {
            line.push_str(&format!(" ({bible})"));
        }
    }
    Some(line)
}

/// The blocks of one audience slide, top to bottom.
pub fn slide(
    slide: &Slide,
    doc: &PresentationDocument,
    shaper: &Shaper,
    locale: &ExportLocale,
) -> Vec<Block> {
    let fit = Fit { shaper };
    let a = &slide.audience;
    let w = WIDTH - 2.0 * MARGIN;
    let mut blocks = Vec::new();
    if a.blank {
        return blocks;
    }
    let mut y = MARGIN;
    let bottom = HEIGHT - MARGIN;
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
            let mut y = ((HEIGHT - total) / 2.0 - 20.0).max(MARGIN);
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
            let area_h = (HEIGHT - 32.0 - caption_h - top).max(120.0);
            if let Some(h) = heading_box {
                blocks.push(Block::Text(h));
            }
            if let Some(image) = &a.image {
                let asset = doc.images.iter().find(|i| i.id == image.asset_id);
                match asset
                    .filter(|i| i.available)
                    .and_then(|i| Some((i, i.width?, i.height?)))
                {
                    Some((asset, iw, ih)) => {
                        let scale = (w / iw as f32).min(area_h / ih as f32);
                        let (dw, dh) = (iw as f32 * scale, ih as f32 * scale);
                        blocks.push(Block::Image(ImageBox {
                            asset_id: asset.id.clone(),
                            x: (WIDTH - dw) / 2.0,
                            y: top + (area_h - dh) / 2.0,
                            w: dw,
                            h: dh,
                        }));
                    }
                    None => blocks.push(Block::Missing {
                        x: MARGIN,
                        y: top,
                        w,
                        h: area_h,
                    }),
                }
            }
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
