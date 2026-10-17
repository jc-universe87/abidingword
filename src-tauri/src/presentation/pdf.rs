//! PDF, from the same document as every other output:
//! * the presentation PDF: one 16:9 page per audience slide, laid out as in
//!   PowerPoint ([`super::layout`]);
//! * the speaker PDF: a phone-sized page per slide with what the audience
//!   sees, the manuscript and the notes, in large type.
//!
//! Text uses the computer's own fonts, embedded as subsets (Unicode, with a
//! text map so it can be searched and copied).

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write as _;

use base64::Engine as _;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream, StringFormat};

use super::document::{PresentationDocument, Slide};
use super::fonts::FontSet;
use super::images::{self, ImageHeader};
use super::layout::{self, rgb, Align, Block, Palette, Role, LINE};
use super::text::{FontRef, Shaper};
use super::ExportOptions;
use crate::error::{AppError, AppResult};

/// The images of a document, by asset id: bytes and header.
pub type ImageData = BTreeMap<String, (Vec<u8>, ImageHeader)>;

/// Reads the images a document uses from a delivery package's data.
pub fn image_data(doc: &PresentationDocument) -> ImageData {
    doc.images
        .iter()
        .filter_map(|asset| {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(asset.data.as_deref()?)
                .ok()?;
            let header = images::header(&bytes)?;
            Some((asset.id.clone(), (bytes, header)))
        })
        .collect()
}

struct Page {
    width: f32,
    height: f32,
    content: String,
    images: BTreeSet<String>,
}

struct Pdf<'a> {
    shaper: Shaper<'a>,
    used: BTreeMap<usize, BTreeSet<u16>>,
    to_unicode: BTreeMap<(usize, u16), char>,
    builtin: [bool; 2],
    pages: Vec<Page>,
}

fn color(hex: &str, stroke: bool) -> String {
    let (r, g, b) = rgb(hex);
    format!(
        "{r:.3} {g:.3} {b:.3} {}\n",
        if stroke { "RG" } else { "rg" }
    )
}

impl<'a> Pdf<'a> {
    fn new(fonts: &'a FontSet) -> Self {
        Self {
            shaper: Shaper { fonts },
            used: BTreeMap::new(),
            to_unicode: BTreeMap::new(),
            builtin: [false; 2],
            pages: Vec::new(),
        }
    }

    fn page(&mut self, width: f32, height: f32, background: &str) -> usize {
        let content = format!("{}0 0 {width} {height} re f\n", color(background, false));
        self.pages.push(Page {
            width,
            height,
            content,
            images: BTreeSet::new(),
        });
        self.pages.len() - 1
    }

    /// One line of text with its baseline at `y` from the top.
    #[allow(clippy::too_many_arguments)]
    fn line(
        &mut self,
        page: usize,
        text: &str,
        x: f32,
        top: f32,
        size: f32,
        bold: bool,
        hex: &str,
    ) {
        let height = self.pages[page].height;
        let baseline = height - top - size * 0.95;
        let mut out = String::new();
        out.push_str(&color(hex, false));
        let mut cursor = x;
        for run in self.shaper.runs(text, bold) {
            let (name, hexcodes) = match run.font {
                FontRef::Embedded(i) => {
                    let set = self.used.entry(i).or_default();
                    for (code, c) in run.codes.iter().zip(&run.chars) {
                        set.insert(*code);
                        self.to_unicode.entry((i, *code)).or_insert(*c);
                    }
                    (
                        format!("F{i}"),
                        run.codes
                            .iter()
                            .map(|c| format!("{c:04X}"))
                            .collect::<String>(),
                    )
                }
                FontRef::Builtin { bold } => {
                    self.builtin[usize::from(bold)] = true;
                    (
                        if bold {
                            "HB".to_string()
                        } else {
                            "H".to_string()
                        },
                        run.codes
                            .iter()
                            .map(|c| format!("{:02X}", *c as u8))
                            .collect(),
                    )
                }
            };
            out.push_str(&format!(
                "BT /{name} {size:.2} Tf 1 0 0 1 {cursor:.2} {baseline:.2} Tm <{hexcodes}> Tj ET\n"
            ));
            cursor += run.width * size;
        }
        self.pages[page].content.push_str(&out);
    }

    fn text_box(&mut self, page: usize, b: &layout::TextBox, palette: &Palette) {
        let hex = match b.role {
            Role::Text => &palette.text,
            Role::Muted => &palette.muted,
            Role::Accent => &palette.accent,
        }
        .clone();
        let mut y = b.y;
        for line in &b.lines {
            let x = match b.align {
                Align::Left => b.x,
                Align::Center => b.x + (b.w - self.shaper.width(line, b.bold, b.size)) / 2.0,
            };
            self.line(page, line, x, y, b.size, b.bold, &hex);
            y += b.size * LINE;
        }
    }

    fn image(&mut self, page: usize, id: &str, x: f32, top: f32, w: f32, h: f32) {
        let height = self.pages[page].height;
        let name = format!("Im{}", image_name(id));
        self.pages[page].images.insert(id.to_string());
        self.pages[page].content.push_str(&format!(
            "q {w:.2} 0 0 {h:.2} {x:.2} {:.2} cm /{name} Do Q\n",
            height - top - h
        ));
    }

    fn frame(&mut self, page: usize, x: f32, top: f32, w: f32, h: f32, hex: &str) {
        let height = self.pages[page].height;
        self.pages[page].content.push_str(&format!(
            "{}1.5 w {x:.2} {:.2} {w:.2} {h:.2} re S\n",
            color(hex, true),
            height - top - h
        ));
    }

    fn rule(&mut self, page: usize, x: f32, top: f32, h: f32, hex: &str) {
        let height = self.pages[page].height;
        self.pages[page].content.push_str(&format!(
            "{}{x:.2} {:.2} 4 {h:.2} re f\n",
            color(hex, false),
            height - top - h
        ));
    }

    /// Writes the file: pages, fonts (subsets of what was used), images.
    fn finish(self, title: &str, image_data: &ImageData) -> AppResult<Vec<u8>> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();

        let mut fonts = Dictionary::new();
        for (index, used) in &self.used {
            let font = font_at(self.shaper.fonts, *index);
            let id = embed_font(&mut doc, font, *index, used, &self.to_unicode)?;
            fonts.set(format!("F{index}"), id);
        }
        for (bold, name, base) in [(false, "H", "Helvetica"), (true, "HB", "Helvetica-Bold")] {
            if self.builtin[usize::from(bold)] {
                let id = doc.add_object(dictionary! {
                    "Type" => "Font",
                    "Subtype" => "Type1",
                    "BaseFont" => base,
                    "Encoding" => "WinAnsiEncoding",
                });
                fonts.set(name, id);
            }
        }

        let mut xobjects = Dictionary::new();
        let wanted: BTreeSet<&String> = self.pages.iter().flat_map(|p| &p.images).collect();
        for id in wanted {
            if let Some((bytes, header)) = image_data.get(id) {
                if let Some(object) = embed_image(&mut doc, bytes, header) {
                    xobjects.set(format!("Im{}", image_name(id)), object);
                }
            }
        }
        let resources = doc.add_object(dictionary! {
            "Font" => fonts,
            "XObject" => xobjects,
        });

        let mut kids = Vec::new();
        for page in &self.pages {
            let content = doc.add_object(flate_stream(Dictionary::new(), page.content.as_bytes()));
            let id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), page.width.into(), page.height.into()],
                "Contents" => content,
                "Resources" => resources,
            });
            kids.push(Object::Reference(id));
        }
        let count = kids.len() as i64;
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => count,
            }),
        );
        let catalog = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        let info = doc.add_object(dictionary! {
            "Title" => Object::String(utf16(title), StringFormat::Hexadecimal),
            "Creator" => Object::string_literal("Abiding Word"),
        });
        doc.trailer.set("Root", catalog);
        doc.trailer.set("Info", info);
        let mut out = Vec::new();
        doc.save_to(&mut out)
            .map_err(|e| AppError::Unexpected(format!("PDF: {e}")))?;
        Ok(out)
    }
}

fn image_name(id: &str) -> String {
    id.chars().filter(char::is_ascii_alphanumeric).collect()
}

fn font_at(fonts: &FontSet, index: usize) -> &super::fonts::Font {
    let regular = fonts.regular.len();
    if index < regular {
        &fonts.regular[index]
    } else {
        &fonts.bold[index - regular]
    }
}

fn utf16(text: &str) -> Vec<u8> {
    let mut out = vec![0xFE, 0xFF];
    for unit in text.encode_utf16() {
        out.extend_from_slice(&unit.to_be_bytes());
    }
    out
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    let _ = encoder.write_all(data);
    encoder.finish().unwrap_or_default()
}

fn flate_stream(mut dict: Dictionary, data: &[u8]) -> Stream {
    dict.set("Filter", "FlateDecode");
    Stream::new(dict, deflate(data)).with_compression(false)
}

fn embed_font(
    doc: &mut Document,
    font: &super::fonts::Font,
    index: usize,
    used: &BTreeSet<u16>,
    to_unicode: &BTreeMap<(usize, u16), char>,
) -> AppResult<ObjectId> {
    let data = font
        .subset(used)
        .ok_or_else(|| AppError::Unexpected("PDF: a font could not be embedded".into()))?;
    let scale = 1000.0 / f32::from(font.units_per_em.max(1));
    let em = |v: i16| (f32::from(v) * scale).round() as i64;
    // A subset's name starts with six letters made from what it holds.
    let tag: String = {
        let mut h: u32 = 2166136261;
        for g in used {
            h = (h ^ u32::from(*g)).wrapping_mul(16777619);
        }
        h ^= index as u32;
        (0..6)
            .map(|i| (b'A' + ((h >> (i * 5)) % 26) as u8) as char)
            .collect()
    };
    let name = format!("{tag}+{}", font.name);
    let length = data.len() as i64;
    let file = doc.add_object(flate_stream(dictionary! { "Length1" => length }, &data));
    let descriptor = doc.add_object(dictionary! {
        "Type" => "FontDescriptor",
        "FontName" => name.as_str(),
        "Flags" => 32,
        "FontBBox" => font.bbox.iter().map(|v| Object::Integer(em(*v))).collect::<Vec<_>>(),
        "ItalicAngle" => 0,
        "Ascent" => em(font.ascender),
        "Descent" => em(font.descender),
        "CapHeight" => em(font.cap_height),
        "StemV" => 80,
        "FontFile2" => file,
    });
    let mut widths = Vec::new();
    for gid in used {
        let w = (f32::from(font.advance(*gid)) * scale).round() as i64;
        widths.push(Object::Integer(i64::from(*gid)));
        widths.push(Object::Array(vec![Object::Integer(w)]));
    }
    let cid = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "CIDFontType2",
        "BaseFont" => name.as_str(),
        "CIDSystemInfo" => dictionary! {
            "Registry" => Object::string_literal("Adobe"),
            "Ordering" => Object::string_literal("Identity"),
            "Supplement" => 0,
        },
        "FontDescriptor" => descriptor,
        "DW" => 1000,
        "W" => widths,
        "CIDToGIDMap" => "Identity",
    });
    let mut cmap = String::from(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n\
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n\
         1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
    );
    let entries: Vec<(u16, char)> = to_unicode
        .iter()
        .filter(|((f, _), _)| *f == index)
        .map(|((_, g), c)| (*g, *c))
        .collect();
    for chunk in entries.chunks(100) {
        cmap.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for (gid, c) in chunk {
            let mut buf = [0u16; 2];
            let units: String = c
                .encode_utf16(&mut buf)
                .iter()
                .map(|u| format!("{u:04X}"))
                .collect();
            cmap.push_str(&format!("<{gid:04X}> <{units}>\n"));
        }
        cmap.push_str("endbfchar\n");
    }
    cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    let to_unicode = doc.add_object(flate_stream(Dictionary::new(), cmap.as_bytes()));
    Ok(doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type0",
        "BaseFont" => name.as_str(),
        "Encoding" => "Identity-H",
        "DescendantFonts" => vec![Object::Reference(cid)],
        "ToUnicode" => to_unicode,
    }))
}

/// A JPEG as it is; a PNG decoded (its transparency as a soft mask).
/// Other kinds are not shown in a PDF.
fn embed_image(doc: &mut Document, bytes: &[u8], header: &ImageHeader) -> Option<ObjectId> {
    match header.media_type {
        "image/jpeg" => {
            let space = match images::jpeg_components(bytes)? {
                1 => "DeviceGray",
                4 => "DeviceCMYK",
                _ => "DeviceRGB",
            };
            let mut dict = dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => i64::from(header.width),
                "Height" => i64::from(header.height),
                "ColorSpace" => space,
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            };
            if space == "DeviceCMYK" {
                dict.set(
                    "Decode",
                    vec![
                        1.into(),
                        0.into(),
                        1.into(),
                        0.into(),
                        1.into(),
                        0.into(),
                        1.into(),
                        0.into(),
                    ],
                );
            }
            Some(doc.add_object(Stream::new(dict, bytes.to_vec()).with_compression(false)))
        }
        "image/png" => {
            let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
            decoder
                .set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
            let mut reader = decoder.read_info().ok()?;
            let mut buf = vec![0; reader.output_buffer_size()?];
            let info = reader.next_frame(&mut buf).ok()?;
            let data = &buf[..info.buffer_size()];
            let (w, h) = (i64::from(info.width), i64::from(info.height));
            let (color, alpha): (Vec<u8>, Option<Vec<u8>>) = match info.color_type {
                png::ColorType::Rgb => (data.to_vec(), None),
                png::ColorType::Rgba => (
                    data.chunks(4).flat_map(|p| [p[0], p[1], p[2]]).collect(),
                    Some(data.chunks(4).map(|p| p[3]).collect()),
                ),
                png::ColorType::Grayscale => {
                    (data.iter().flat_map(|g| [*g, *g, *g]).collect(), None)
                }
                png::ColorType::GrayscaleAlpha => (
                    data.chunks(2).flat_map(|p| [p[0], p[0], p[0]]).collect(),
                    Some(data.chunks(2).map(|p| p[1]).collect()),
                ),
                png::ColorType::Indexed => return None,
            };
            let mut dict = dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => w,
                "Height" => h,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            };
            if let Some(alpha) = alpha {
                let mask = doc.add_object(flate_stream(
                    dictionary! {
                        "Type" => "XObject",
                        "Subtype" => "Image",
                        "Width" => w,
                        "Height" => h,
                        "ColorSpace" => "DeviceGray",
                        "BitsPerComponent" => 8,
                    },
                    &alpha,
                ));
                dict.set("SMask", mask);
            }
            Some(doc.add_object(flate_stream(dict, &color)))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// The two PDFs
// ---------------------------------------------------------------------------

/// The presentation PDF: one page per audience slide.
pub fn slides(
    doc: &PresentationDocument,
    image_data: &ImageData,
    fonts: &FontSet,
    options: &ExportOptions,
) -> AppResult<Vec<u8>> {
    let palette = layout::palette(&doc.theme);
    let mut pdf = Pdf::new(fonts);
    for slide in &doc.slides {
        let page = pdf.page(layout::WIDTH, layout::HEIGHT, &palette.background);
        let blocks = layout::slide(slide, doc, &pdf.shaper, &options.locale);
        draw(&mut pdf, page, &blocks, &palette, image_data, options);
    }
    pdf.finish(&doc.title, image_data)
}

fn draw(
    pdf: &mut Pdf,
    page: usize,
    blocks: &[Block],
    palette: &Palette,
    image_data: &ImageData,
    options: &ExportOptions,
) {
    for block in blocks {
        match block {
            Block::Text(b) => pdf.text_box(page, b, palette),
            Block::Image(i)
                if image_data
                    .get(&i.asset_id)
                    .is_some_and(|(_, h)| pdf_can_show(h)) =>
            {
                pdf.image(page, &i.asset_id, i.x, i.y, i.w, i.h);
            }
            Block::Image(layout::ImageBox { x, y, w, h, .. }) | Block::Missing { x, y, w, h } => {
                pdf.frame(page, *x, *y, *w, *h, &palette.muted);
                let label = &options.locale.labels.image_unavailable;
                let size = 22.0;
                let tw = pdf.shaper.width(label, false, size);
                pdf.line(
                    page,
                    label,
                    x + (w - tw) / 2.0,
                    y + h / 2.0 - size / 2.0,
                    size,
                    false,
                    &palette.muted,
                );
            }
        }
    }
}

fn pdf_can_show(header: &ImageHeader) -> bool {
    matches!(header.media_type, "image/jpeg" | "image/png")
}

/// The speaker PDF: a phone-sized page (9:16) for each slide, in large
/// type, with what the audience sees and then the speaker's own text.
pub fn speaker(
    doc: &PresentationDocument,
    image_data: &ImageData,
    fonts: &FontSet,
    options: &ExportOptions,
) -> AppResult<Vec<u8>> {
    const W: f32 = 360.0;
    const H: f32 = 640.0;
    const M: f32 = 24.0;
    let palette = layout::palette("light");
    let loc = &options.locale;
    let mut pdf = Pdf::new(fonts);
    let total = doc.slides.len();
    for slide in &doc.slides {
        let mut page = pdf.page(W, H, &palette.background);
        let mut y = M;
        let width = W - 2.0 * M;
        // Writes wrapped text, going on to a new page when the page is full.
        let mut write = |pdf: &mut Pdf,
                         page: &mut usize,
                         y: &mut f32,
                         text: &str,
                         size: f32,
                         bold: bool,
                         hex: &str,
                         indent: f32| {
            for line in pdf.shaper.wrap(text, bold, size, width - indent) {
                if *y + size * LINE > H - M {
                    *page = pdf.page(W, H, &palette.background);
                    *y = M;
                }
                pdf.line(*page, &line, M + indent, *y, size, bold, hex);
                *y += size * LINE;
            }
        };
        let counter = format!("{} {} / {total}", loc.labels.slide, slide.index + 1);
        write(
            &mut pdf,
            &mut page,
            &mut y,
            &counter,
            13.0,
            false,
            &palette.muted,
            0.0,
        );
        y += 4.0;
        let a = &slide.audience;
        let start = (page, y);
        if a.blank {
            write(
                &mut pdf,
                &mut page,
                &mut y,
                &loc.labels.pause,
                18.0,
                true,
                &palette.muted,
                12.0,
            );
        }
        if let Some(heading) = &a.heading {
            write(
                &mut pdf,
                &mut page,
                &mut y,
                heading,
                22.0,
                true,
                &palette.text,
                12.0,
            );
        }
        if let Some(line) = layout::reference_line(slide, loc) {
            write(
                &mut pdf,
                &mut page,
                &mut y,
                &line,
                17.0,
                true,
                &palette.accent,
                12.0,
            );
        }
        let verses = layout::verses_text(slide);
        if !verses.is_empty() {
            write(
                &mut pdf,
                &mut page,
                &mut y,
                &verses,
                16.0,
                false,
                &palette.text,
                12.0,
            );
        }
        if let Some(body) = &a.body {
            write(
                &mut pdf,
                &mut page,
                &mut y,
                body,
                17.0,
                slide.kind == "question",
                &palette.text,
                12.0,
            );
        }
        if let Some(image) = &a.image {
            let mut caption = image.caption.clone().unwrap_or_default();
            if image.generated {
                caption = format!("{caption} ({})", loc.labels.generated_image)
                    .trim()
                    .to_string();
            }
            if let Some((_, header)) = image_data
                .get(&image.asset_id)
                .filter(|(_, h)| pdf_can_show(h))
            {
                let scale =
                    ((width - 12.0) / header.width as f32).min(200.0 / header.height as f32);
                let (dw, dh) = (header.width as f32 * scale, header.height as f32 * scale);
                if y + dh > H - M {
                    page = pdf.page(W, H, &palette.background);
                    y = M;
                }
                pdf.image(page, &image.asset_id, M + 12.0, y, dw, dh);
                y += dh + 6.0;
            }
            if !caption.is_empty() {
                write(
                    &mut pdf,
                    &mut page,
                    &mut y,
                    &caption,
                    15.0,
                    false,
                    &palette.muted,
                    12.0,
                );
            }
        }
        // A bar beside what the audience sees, on the slide's first page.
        if page == start.0 && y > start.1 {
            pdf.rule(page, M, start.1, y - start.1, &palette.accent);
        }
        y += 12.0;
        speaker_text(
            &mut pdf, &mut page, &mut y, slide, options, &mut write, &palette,
        );
    }
    pdf.finish(&doc.title, image_data)
}

type Writer<'w> = dyn FnMut(&mut Pdf, &mut usize, &mut f32, &str, f32, bool, &str, f32) + 'w;

fn speaker_text(
    pdf: &mut Pdf,
    page: &mut usize,
    y: &mut f32,
    slide: &Slide,
    options: &ExportOptions,
    write: &mut Writer,
    palette: &Palette,
) {
    let loc = &options.locale;
    for part in &slide.speaker.manuscript {
        write(
            pdf,
            page,
            y,
            loc.field(&part.field),
            14.0,
            true,
            &palette.muted,
            0.0,
        );
        write(
            pdf,
            page,
            y,
            loc.part_text(&part.field, &part.text),
            17.0,
            false,
            &palette.text,
            0.0,
        );
        *y += 8.0;
    }
    if !slide.speaker.notes.is_empty() {
        write(
            pdf,
            page,
            y,
            &loc.labels.speaker_notes,
            14.0,
            true,
            &palette.muted,
            0.0,
        );
        write(
            pdf,
            page,
            y,
            &slide.speaker.notes,
            17.0,
            false,
            &palette.text,
            0.0,
        );
        *y += 8.0;
    }
    if options.citations && !slide.citations.is_empty() {
        write(
            pdf,
            page,
            y,
            &loc.labels.citations,
            14.0,
            true,
            &palette.muted,
            0.0,
        );
        for c in &slide.citations {
            let mut line = c.title.clone();
            if let Some(d) = &c.detail {
                line.push_str(&format!(" — {d}"));
            }
            if let Some(u) = &c.url {
                line.push_str(&format!(" {u}"));
            }
            write(pdf, page, y, line.trim(), 14.0, false, &palette.muted, 0.0);
        }
    }
}
