//! Importing a church's PowerPoint design (v0.18.1). A .pptx (or .potx) is
//! read for its design only — slide size, theme colours and fonts, slide
//! masters and layouts, backgrounds, pictures, plain bands, fixed texts and
//! the text boxes of placeholders with their fonts, sizes, colours,
//! alignment, margins, line spacing and fitting — never for the deck's own
//! slides. What cannot be reproduced reliably is reported, never quietly
//! moved, replaced or dropped: SmartArt, charts, tables, freeform and
//! rotated shapes, effects, WordArt, video and vector images. Keynote and
//! Google Slides designs come in the same way, exported as .pptx.
//!
//! Positions become points on the source's own page (1 pt = 12 700 EMU).

use std::collections::{BTreeMap, HashMap};
use std::io::Read;

use quick_xml::events::Event;
use serde::{Deserialize, Serialize};

use super::font_catalog::{self, CatalogFace, FontStatus};
use super::template::{
    self, Background, Crop, FilledRect, FontChoice, Footer, Frame, ImageFill, Placed, RoleLayout,
    TemplateColors, TemplateDefinition, TemplateFonts, TextFrame,
};
use super::template_store::TemplateStore;
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::adapters::epub::decode_references_once;

const EMU_PER_POINT: f32 = 12_700.0;
/// The whole file may unpack to at most this much (a guard against broken files).
const UNPACKED_MAX: u64 = 600 * 1024 * 1024;
const PART_MAX: u64 = 60 * 1024 * 1024;

// ---------------------------------------------------------------------------
// What the importer gives back
// ---------------------------------------------------------------------------

/// The design read from a file, before the person confirms it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTemplate {
    /// A name for it (the file's title or its name).
    pub name: String,
    /// The design without layouts chosen yet (`roles` is filled from
    /// `suggestions` and the person's choices).
    pub definition: TemplateDefinition,
    /// The source's layouts, each converted.
    pub layouts: Vec<SourceLayout>,
    /// For each kind of slide, the source layout suggested for it (only where obvious).
    pub suggestions: BTreeMap<String, String>,
    pub report: Report,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceLayout {
    /// "layout3" (the part's name).
    pub id: String,
    /// The name the source gives it ("Bible Verse").
    pub name: String,
    /// The layout's type in the source ("title", "obj", "secHead", "pic", "blank"…).
    pub kind: String,
    pub layout: RoleLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub file_name: String,
    /// The page in points and its proportions ("16:9", "4:3", "16:10" or "other").
    pub width: f32,
    pub height: f32,
    pub ratio: String,
    pub masters: usize,
    pub layouts: usize,
    /// The deck's own slides (never imported).
    pub slides: usize,
    pub fonts: Vec<FontReport>,
    pub items: Vec<ReportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontReport {
    pub family: String,
    pub bold: bool,
    pub italic: bool,
    pub status: FontStatus,
    /// A PDF can include it (TrueType, embedding allowed).
    pub embeddable: bool,
    /// An installed family that looks like the same design, offered — never applied.
    pub suggestion: Option<String>,
    /// Where it is used: "heading", "body" or layout names.
    pub used_in: Vec<String>,
}

/// One line of the compatibility report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct ReportItem {
    /// "supported", "attention" or "unsupported".
    pub level: String,
    /// What it is (translated by the interface): backgroundImage, smartArt…
    pub code: String,
    /// The source layout or master it concerns.
    pub layout: Option<String>,
    /// A name, a file type, a size.
    pub detail: Option<String>,
    pub count: usize,
}

// ---------------------------------------------------------------------------
// A small XML tree
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
struct Node {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<Node>,
    text: String,
}

impl Node {
    fn local(&self) -> &str {
        self.name.rsplit(':').next().unwrap_or(&self.name)
    }
    fn is(&self, name: &str) -> bool {
        self.name == name
    }
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
    fn num(&self, name: &str) -> Option<f32> {
        self.attr(name).and_then(|v| v.parse::<f32>().ok())
    }
    fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.is(name))
    }
    fn kids<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |c| c.is(name))
    }
    fn path(&self, names: &[&str]) -> Option<&Node> {
        let mut n = self;
        for name in names {
            n = n.child(name)?;
        }
        Some(n)
    }
    /// Every text run inside, joined by paragraph.
    fn all_text(&self) -> String {
        let mut paragraphs = Vec::new();
        for p in self.kids("a:p") {
            let mut line = String::new();
            collect_text(p, &mut line);
            paragraphs.push(line);
        }
        paragraphs.join("\n").trim().to_string()
    }
}

fn collect_text(n: &Node, out: &mut String) {
    if n.is("a:t") {
        out.push_str(&n.text);
    }
    for c in &n.children {
        collect_text(c, out);
    }
}

fn parse(xml: &[u8]) -> AppResult<Node> {
    let mut reader = quick_xml::Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut stack: Vec<Node> = vec![Node::default()];
    let mut buf = Vec::new();
    let node_of = |e: &quick_xml::events::BytesStart| -> Node {
        let name = e.name().as_ref().to_string();
        let attrs = e
            .attributes()
            .flatten()
            .map(|a| (a.key.as_ref().to_string(), decode_references_once(&a.value)))
            .collect();
        Node {
            name,
            attrs,
            ..Default::default()
        }
    };
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => stack.push(node_of(&e)),
            Ok(Event::Empty(e)) => {
                let n = node_of(&e);
                if let Some(top) = stack.last_mut() {
                    top.children.push(n);
                }
            }
            Ok(Event::End(_)) => {
                if stack.len() > 1 {
                    let n = stack.pop().unwrap_or_default();
                    if let Some(top) = stack.last_mut() {
                        top.children.push(n);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&t);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if let Some(top) = stack.last_mut() {
                    top.text
                        .push_str(&decode_references_once(&format!("&{};", &*r)));
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err(not_a_presentation()),
        }
        buf.clear();
    }
    let mut root = stack.into_iter().next().unwrap_or_default();
    root.children
        .retain(|c| !c.name.is_empty() && !c.name.starts_with('?'));
    root.children
        .into_iter()
        .next()
        .ok_or_else(not_a_presentation)
}

fn not_a_presentation() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "presentation.templateNotPptx",
        "This file is not a PowerPoint presentation (.pptx) that can be read.",
    ))
}

// ---------------------------------------------------------------------------
// The package
// ---------------------------------------------------------------------------

struct Package {
    files: HashMap<String, Vec<u8>>,
}

impl Package {
    fn open(bytes: &[u8]) -> AppResult<Package> {
        let mut archive =
            zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| not_a_presentation())?;
        let mut files = HashMap::new();
        let mut total = 0u64;
        for i in 0..archive.len() {
            let mut f = archive.by_index(i).map_err(|_| not_a_presentation())?;
            if f.is_dir() {
                continue;
            }
            let name = f.name().to_string();
            // Only what a design can need; a deck's videos are not unpacked.
            let wanted = name == "[Content_Types].xml"
                || name.ends_with(".rels")
                || name.starts_with("ppt/presentation.xml")
                || name.starts_with("ppt/slideMasters/")
                || name.starts_with("ppt/slideLayouts/")
                || name.starts_with("ppt/theme/")
                || name.starts_with("ppt/media/")
                || name.starts_with("docProps/core.xml");
            if !wanted {
                continue;
            }
            if f.size() > PART_MAX {
                continue;
            }
            total += f.size();
            if total > UNPACKED_MAX {
                return Err(AppError::InvalidInput(UserMessage::new(
                    "presentation.templateTooLarge",
                    "This presentation is too large to read as a template.",
                )));
            }
            let mut data = Vec::with_capacity(f.size() as usize);
            f.by_ref()
                .take(PART_MAX)
                .read_to_end(&mut data)
                .map_err(|_| not_a_presentation())?;
            files.insert(name, data);
        }
        if !files.contains_key("ppt/presentation.xml") {
            return Err(not_a_presentation());
        }
        Ok(Package { files })
    }

    fn xml(&self, path: &str) -> Option<Node> {
        parse(self.files.get(path)?).ok()
    }

    /// The relationships of a part, by id: (type, target path).
    fn rels(&self, part: &str) -> HashMap<String, (String, String)> {
        let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
        let path = format!("{dir}/_rels/{file}.rels");
        let mut out = HashMap::new();
        if let Some(root) = self.xml(&path) {
            for r in root.children.iter().filter(|c| c.local() == "Relationship") {
                let (Some(id), Some(target)) = (r.attr("Id"), r.attr("Target")) else {
                    continue;
                };
                if r.attr("TargetMode") == Some("External") {
                    continue;
                }
                let kind = r.attr("Type").unwrap_or_default();
                let kind = kind.rsplit('/').next().unwrap_or_default().to_string();
                out.insert(id.to_string(), (kind, resolve(dir, target)));
            }
        }
        out
    }
}

/// A relationship target as a path in the package.
fn resolve(dir: &str, target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        return abs.to_string();
    }
    let mut parts: Vec<&str> = if dir.is_empty() {
        Vec::new()
    } else {
        dir.split('/').collect()
    };
    for seg in target.split('/') {
        match seg {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            s => parts.push(s),
        }
    }
    parts.join("/")
}

// ---------------------------------------------------------------------------
// Theme and colours
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
struct Theme {
    colors: HashMap<String, String>,
    major: String,
    minor: String,
    /// Background fill styles (for `bgRef idx="1001…"`).
    bg_fills: Vec<Node>,
}

fn theme(root: &Node) -> Theme {
    let mut t = Theme::default();
    let Some(elements) = root.child("a:themeElements") else {
        return t;
    };
    if let Some(scheme) = elements.child("a:clrScheme") {
        for c in &scheme.children {
            let value = c
                .child("a:srgbClr")
                .and_then(|s| s.attr("val"))
                .or_else(|| c.child("a:sysClr").and_then(|s| s.attr("lastClr")))
                .map(|v| format!("#{}", v.to_ascii_uppercase()));
            if let Some(v) = value {
                t.colors.insert(c.local().to_string(), v);
            }
        }
    }
    if let Some(fonts) = elements.child("a:fontScheme") {
        let latin = |name: &str| {
            fonts
                .path(&[name, "a:latin"])
                .and_then(|l| l.attr("typeface"))
                .unwrap_or_default()
                .to_string()
        };
        t.major = latin("a:majorFont");
        t.minor = latin("a:minorFont");
    }
    if let Some(list) = elements.path(&["a:fmtScheme", "a:bgFillStyleLst"]) {
        t.bg_fills = list.children.clone();
    }
    t
}

/// The master's colour mapping (bg1 → lt1…).
fn clr_map(master: &Node) -> HashMap<String, String> {
    let mut m: HashMap<String, String> = [
        ("bg1", "lt1"),
        ("tx1", "dk1"),
        ("bg2", "lt2"),
        ("tx2", "dk2"),
    ]
    .into_iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect();
    if let Some(map) = master.child("p:clrMap") {
        for (k, v) in &map.attrs {
            m.insert(k.clone(), v.clone());
        }
    }
    m
}

struct Colors<'a> {
    theme: &'a Theme,
    map: &'a HashMap<String, String>,
}

fn hsl(c: (f32, f32, f32)) -> (f32, f32, f32) {
    let (r, g, b) = c;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if max == r {
        ((g - b) / d + if g < b { 6.0 } else { 0.0 }) / 6.0
    } else if max == g {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };
    (h, s, l)
}

fn rgb_of(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let f = |mut t: f32| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0))
}

impl Colors<'_> {
    /// A colour element's value and its transparency (1 = opaque); `ph` is
    /// the colour standing in for `phClr`.
    fn of(&self, n: &Node, ph: Option<&str>) -> Option<(String, f32)> {
        let base = match n.name.as_str() {
            "a:srgbClr" => n
                .attr("val")
                .map(|v| format!("#{}", v.to_ascii_uppercase())),
            "a:sysClr" => n
                .attr("lastClr")
                .map(|v| format!("#{}", v.to_ascii_uppercase())),
            "a:schemeClr" => {
                let v = n.attr("val")?;
                if v == "phClr" {
                    ph.map(str::to_string)
                } else {
                    let mapped = self.map.get(v).map(String::as_str).unwrap_or(v);
                    self.theme.colors.get(mapped).cloned()
                }
            }
            "a:prstClr" => match n.attr("val")? {
                "black" => Some("#000000".into()),
                "white" => Some("#FFFFFF".into()),
                "red" => Some("#FF0000".into()),
                "gray" | "grey" => Some("#808080".into()),
                _ => None,
            },
            _ => None,
        }?;
        let mut c = super::layout::rgb(&base);
        let mut alpha = 1.0;
        for m in &n.children {
            let v = m.num("val").unwrap_or(100_000.0) / 100_000.0;
            match m.name.as_str() {
                "a:lumMod" | "a:lumOff" => {
                    let (h, s, l) = hsl(c);
                    let l = if m.name == "a:lumMod" { l * v } else { l + v };
                    c = rgb_of(h, s, l.clamp(0.0, 1.0));
                }
                "a:shade" => c = (c.0 * v, c.1 * v, c.2 * v),
                "a:tint" => {
                    c = (
                        c.0 + (1.0 - c.0) * (1.0 - v),
                        c.1 + (1.0 - c.1) * (1.0 - v),
                        c.2 + (1.0 - c.2) * (1.0 - v),
                    )
                }
                "a:alpha" => alpha = v,
                _ => {}
            }
        }
        let hex = |x: f32| (x.clamp(0.0, 1.0) * 255.0).round() as u8;
        Some((
            format!("#{:02X}{:02X}{:02X}", hex(c.0), hex(c.1), hex(c.2)),
            alpha.clamp(0.0, 1.0),
        ))
    }

    /// The colour inside a fill (`a:solidFill`).
    fn solid(&self, fill: &Node) -> Option<(String, f32)> {
        fill.children.iter().find_map(|c| self.of(c, None))
    }
}

// ---------------------------------------------------------------------------
// Reading masters and layouts
// ---------------------------------------------------------------------------

/// Text properties gathered along the inheritance chain.
#[derive(Debug, Clone, Default)]
struct TextProps {
    size: Option<f32>,
    bold: Option<bool>,
    italic: Option<bool>,
    color: Option<String>,
    font: Option<String>,
    align: Option<String>,
    line_spacing: Option<f32>,
}

impl TextProps {
    /// Fills what is not set yet from a paragraph style (`a:lvl1pPr`).
    fn under(&mut self, ppr: Option<&Node>, colors: &Colors) {
        let Some(ppr) = ppr else { return };
        if self.align.is_none() {
            self.align = ppr.attr("algn").map(str::to_string);
        }
        if self.line_spacing.is_none() {
            if let Some(ls) = ppr.child("a:lnSpc") {
                if let Some(pct) = ls.child("a:spcPct").and_then(|p| p.num("val")) {
                    // PowerPoint's single spacing is about 1.2 × the size.
                    self.line_spacing = Some(1.2 * pct / 100_000.0);
                } else if let Some(pts) = ls.child("a:spcPts").and_then(|p| p.num("val")) {
                    self.line_spacing = Some(-pts / 100.0);
                }
            }
        }
        if let Some(r) = ppr.child("a:defRPr") {
            if self.size.is_none() {
                self.size = r.num("sz").map(|s| s / 100.0);
            }
            if self.bold.is_none() {
                self.bold = r.attr("b").map(|b| b == "1" || b == "true");
            }
            if self.italic.is_none() {
                self.italic = r.attr("i").map(|b| b == "1" || b == "true");
            }
            if self.color.is_none() {
                self.color = r
                    .child("a:solidFill")
                    .and_then(|f| colors.solid(f))
                    .map(|c| c.0);
            }
            if self.font.is_none() {
                self.font = r
                    .child("a:latin")
                    .and_then(|l| l.attr("typeface"))
                    .filter(|t| !t.is_empty())
                    .map(str::to_string);
            }
        }
    }
}

#[derive(Debug, Clone, Default)]
struct BodyProps {
    insets: [Option<f32>; 4],
    anchor: Option<String>,
    /// "shrink", "grow" or "none".
    fit: Option<String>,
    vertical: bool,
    no_wrap: bool,
}

impl BodyProps {
    fn under(&mut self, body: Option<&Node>) {
        let Some(b) = body else { return };
        for (i, k) in ["lIns", "tIns", "rIns", "bIns"].iter().enumerate() {
            if self.insets[i].is_none() {
                self.insets[i] = b.num(k).map(|v| v / EMU_PER_POINT);
            }
        }
        if self.anchor.is_none() {
            self.anchor = b.attr("anchor").map(str::to_string);
        }
        if self.fit.is_none() {
            if b.child("a:normAutofit").is_some() {
                self.fit = Some("shrink".into());
            } else if b.child("a:spAutoFit").is_some() {
                self.fit = Some("grow".into());
            } else if b.child("a:noAutofit").is_some() {
                self.fit = Some("none".into());
            }
        }
        if let Some(v) = b.attr("vert") {
            self.vertical |= v != "horz";
        }
        self.no_wrap |= b.attr("wrap") == Some("none");
    }
}

/// A placeholder as the master or a layout defines it.
#[derive(Debug, Clone)]
struct Ph {
    kind: String,
    idx: Option<String>,
    rect: Option<(f32, f32, f32, f32)>,
    node: Node,
}

fn ph_of(sp: &Node) -> Option<(String, Option<String>)> {
    let ph = sp
        .children
        .iter()
        .find(|c| c.name.starts_with("p:nv"))?
        .child("p:nvPr")?
        .child("p:ph")?;
    Some((
        ph.attr("type").unwrap_or("obj").to_string(),
        ph.attr("idx").map(str::to_string),
    ))
}

fn xfrm(sp_pr: Option<&Node>) -> Option<(f32, f32, f32, f32)> {
    let x = sp_pr?.child("a:xfrm")?;
    let off = x.child("a:off")?;
    let ext = x.child("a:ext")?;
    Some((
        off.num("x")? / EMU_PER_POINT,
        off.num("y")? / EMU_PER_POINT,
        ext.num("cx")? / EMU_PER_POINT,
        ext.num("cy")? / EMU_PER_POINT,
    ))
}

/// A group's mapping of its children's coordinates to the page.
#[derive(Debug, Clone, Copy)]
struct Transform {
    sx: f32,
    sy: f32,
    dx: f32,
    dy: f32,
}

impl Transform {
    const ID: Transform = Transform {
        sx: 1.0,
        sy: 1.0,
        dx: 0.0,
        dy: 0.0,
    };
    fn apply(&self, (x, y, w, h): (f32, f32, f32, f32)) -> (f32, f32, f32, f32) {
        (
            x * self.sx + self.dx,
            y * self.sy + self.dy,
            w * self.sx,
            h * self.sy,
        )
    }
}

/// Is a placeholder type a title?
fn is_title(kind: &str) -> bool {
    matches!(kind, "title" | "ctrTitle")
}

/// A font family used, and where.
#[derive(Debug, Clone, Default)]
struct FontUse {
    family: String,
    bold: bool,
    italic: bool,
    used_in: Vec<String>,
}

struct Reader<'a> {
    pkg: &'a Package,
    store: &'a TemplateStore,
    items: BTreeMap<(String, String, Option<String>, Option<String>), usize>,
    assets: Vec<template::TemplateAsset>,
    /// media path → asset id, read once.
    media: HashMap<String, Option<String>>,
    fonts: Vec<FontUse>,
    theme: Theme,
    map: HashMap<String, String>,
}

impl Reader<'_> {
    fn colors(&self) -> Colors<'_> {
        Colors {
            theme: &self.theme,
            map: &self.map,
        }
    }

    fn note(&mut self, level: &str, code: &str, layout: Option<&str>, detail: Option<&str>) {
        *self
            .items
            .entry((
                level.to_string(),
                code.to_string(),
                layout.map(str::to_string),
                detail.map(str::to_string),
            ))
            .or_insert(0) += 1;
    }

    fn use_font(&mut self, family: &str, bold: bool, italic: bool, place: &str) {
        let family = family.trim();
        if family.is_empty() {
            return;
        }
        let entry =
            match self.fonts.iter_mut().find(|f| {
                f.family.eq_ignore_ascii_case(family) && f.bold == bold && f.italic == italic
            }) {
                Some(e) => e,
                None => {
                    self.fonts.push(FontUse {
                        family: family.to_string(),
                        bold,
                        italic,
                        used_in: Vec::new(),
                    });
                    self.fonts.last_mut().expect("just added")
                }
            };
        if !entry.used_in.iter().any(|u| u == place) {
            entry.used_in.push(place.to_string());
        }
    }

    /// Keeps a picture the design uses; `None` (reported) when its kind cannot be shown.
    fn asset(&mut self, part: &str, rid: &str, place: &str) -> Option<String> {
        let rels = self.pkg.rels(part);
        let (_, target) = rels.get(rid)?;
        if let Some(known) = self.media.get(target) {
            return known.clone();
        }
        let id = self.pkg.files.get(target).and_then(|bytes| {
            let name = target.rsplit('/').next().unwrap_or(target);
            match self.store.add(bytes, name) {
                Ok(a) => {
                    let id = a.id.clone();
                    if !self.assets.iter().any(|x| x.id == id) {
                        self.assets.push(a);
                    }
                    Some(id)
                }
                Err(_) => None,
            }
        });
        if id.is_none() {
            let ext = target
                .rsplit('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            self.note("unsupported", "imageFormat", Some(place), Some(&ext));
        }
        self.media.insert(target.clone(), id.clone());
        id
    }

    /// The crop a picture fill has, as shares of the image.
    fn crop(blip_fill: &Node) -> Crop {
        let Some(r) = blip_fill.child("a:srcRect") else {
            return Crop::default();
        };
        let v = |k: &str| r.num(k).unwrap_or(0.0) / 100_000.0;
        Crop {
            left: v("l"),
            top: v("t"),
            right: v("r"),
            bottom: v("b"),
        }
    }

    fn background(&mut self, part: &str, c_sld: &Node, place: &str) -> Option<Background> {
        let bg = c_sld.child("p:bg")?;
        if let Some(pr) = bg.child("p:bgPr") {
            return self.fill_background(part, pr, None, place);
        }
        let reference = bg.child("p:bgRef")?;
        let ph = reference
            .children
            .iter()
            .find_map(|c| self.colors().of(c, None))
            .map(|c| c.0);
        let idx = reference.num("idx").unwrap_or(0.0) as usize;
        if idx >= 1001 {
            if let Some(style) = self.theme.bg_fills.get(idx - 1001).cloned() {
                let holder = Node {
                    children: vec![style],
                    ..Default::default()
                };
                return self.fill_background(part, &holder, ph.as_deref(), place);
            }
        }
        ph.map(|c| Background {
            color: Some(c),
            image: None,
        })
    }

    fn fill_background(
        &mut self,
        part: &str,
        holder: &Node,
        ph: Option<&str>,
        place: &str,
    ) -> Option<Background> {
        for fill in &holder.children {
            match fill.name.as_str() {
                "a:solidFill" => {
                    let c = fill.children.iter().find_map(|x| self.colors().of(x, ph))?;
                    return Some(Background {
                        color: Some(c.0),
                        image: None,
                    });
                }
                "a:blipFill" => {
                    let rid = fill.child("a:blip").and_then(|b| b.attr("r:embed"));
                    if fill.child("a:tile").is_some() {
                        self.note("attention", "tiledBackground", Some(place), None);
                    }
                    let id = rid.and_then(|r| self.asset(part, r, place))?;
                    self.note("supported", "backgroundImage", Some(place), None);
                    return Some(Background {
                        color: None,
                        image: Some(ImageFill {
                            asset_id: id,
                            crop: Self::crop(fill),
                        }),
                    });
                }
                "a:gradFill" => {
                    // Not drawn as a gradient: its first colour, and the report says so.
                    let first = fill
                        .path(&["a:gsLst"])
                        .and_then(|l| l.children.first())
                        .and_then(|gs| gs.children.iter().find_map(|x| self.colors().of(x, ph)));
                    self.note("attention", "gradientBackground", Some(place), None);
                    return first.map(|c| Background {
                        color: Some(c.0),
                        image: None,
                    });
                }
                "a:pattFill" => {
                    self.note("attention", "patternBackground", Some(place), None);
                    let fg = fill
                        .child("a:fgClr")
                        .and_then(|f| f.children.iter().find_map(|x| self.colors().of(x, ph)));
                    return fg.map(|c| Background {
                        color: Some(c.0),
                        image: None,
                    });
                }
                _ => {}
            }
        }
        None
    }

    /// Effects (shadow, glow, reflection…) a shape has, which are not drawn.
    fn effects(&mut self, sp_pr: Option<&Node>, place: &str) {
        let has = sp_pr
            .and_then(|p| p.child("a:effectLst"))
            .is_some_and(|e| !e.children.is_empty())
            || sp_pr.and_then(|p| p.child("a:scene3d")).is_some()
            || sp_pr.and_then(|p| p.child("a:sp3d")).is_some();
        if has {
            self.note("attention", "effects", Some(place), None);
        }
    }

    /// The non-placeholder shapes of a tree: pictures, bands and fixed texts.
    fn shapes(
        &mut self,
        part: &str,
        tree: &Node,
        t: Transform,
        place: &str,
        out: &mut RoleLayout,
        phs: &mut Vec<Ph>,
    ) {
        for n in &tree.children {
            match n.name.as_str() {
                "p:sp" => {
                    if let Some((kind, idx)) = ph_of(n) {
                        phs.push(Ph {
                            kind,
                            idx,
                            rect: xfrm(n.child("p:spPr")).map(|r| t.apply(r)),
                            node: n.clone(),
                        });
                        continue;
                    }
                    self.shape(part, n, t, place, out);
                }
                "p:pic" => self.picture(part, n, t, place, out),
                "p:grpSp" => {
                    let gt = n.path(&["p:grpSpPr", "a:xfrm"]).and_then(|x| {
                        let off = x.child("a:off")?;
                        let ext = x.child("a:ext")?;
                        let ch_off = x.child("a:chOff")?;
                        let ch_ext = x.child("a:chExt")?;
                        if x.num("rot").unwrap_or(0.0) != 0.0 {
                            return None;
                        }
                        let sx = ext.num("cx")? / ch_ext.num("cx")?.max(1.0);
                        let sy = ext.num("cy")? / ch_ext.num("cy")?.max(1.0);
                        Some(Transform {
                            sx: t.sx * sx,
                            sy: t.sy * sy,
                            dx: t.dx
                                + t.sx
                                    * (off.num("x")? / EMU_PER_POINT
                                        - ch_off.num("x")? / EMU_PER_POINT * sx),
                            dy: t.dy
                                + t.sy
                                    * (off.num("y")? / EMU_PER_POINT
                                        - ch_off.num("y")? / EMU_PER_POINT * sy),
                        })
                    });
                    match gt {
                        Some(gt) => self.shapes(part, n, gt, place, out, phs),
                        None => self.note("unsupported", "rotatedGroup", Some(place), None),
                    }
                }
                "p:graphicFrame" => {
                    let uri = n
                        .path(&["a:graphic", "a:graphicData"])
                        .and_then(|g| g.attr("uri"))
                        .unwrap_or_default();
                    let code = if uri.ends_with("/table") {
                        "table"
                    } else if uri.contains("chart") {
                        "chart"
                    } else if uri.ends_with("/diagram") {
                        "smartArt"
                    } else {
                        "embeddedObject"
                    };
                    self.note("unsupported", code, Some(place), None);
                }
                "p:cxnSp" => self.note("unsupported", "line", Some(place), None),
                "p:contentPart" => self.note("unsupported", "ink", Some(place), None),
                "mc:AlternateContent" => {
                    if let Some(fallback) = n.child("mc:Fallback") {
                        self.shapes(part, fallback, t, place, out, phs);
                    }
                }
                _ => {}
            }
        }
    }

    fn shape(&mut self, part: &str, n: &Node, t: Transform, place: &str, out: &mut RoleLayout) {
        let sp_pr = n.child("p:spPr");
        let Some(rect) = xfrm(sp_pr) else { return };
        let x = sp_pr.and_then(|p| p.child("a:xfrm"));
        if x.is_some_and(|x| {
            x.num("rot").unwrap_or(0.0) != 0.0
                || x.attr("flipH") == Some("1")
                || x.attr("flipV") == Some("1")
        }) {
            self.note("unsupported", "rotatedShape", Some(place), None);
            return;
        }
        let rect = t.apply(rect);
        let geometry = sp_pr
            .and_then(|p| p.child("a:prstGeom"))
            .and_then(|g| g.attr("prst"));
        let custom = sp_pr.and_then(|p| p.child("a:custGeom")).is_some();
        let text = n.child("p:txBody").map(Node::all_text).unwrap_or_default();
        if n.path(&["p:txBody", "a:bodyPr", "a:prstTxWarp"]).is_some() {
            self.note("unsupported", "wordArt", Some(place), None);
            return;
        }
        // A picture used as a shape's fill.
        if let Some(blip) = sp_pr.and_then(|p| p.child("a:blipFill")) {
            if geometry == Some("rect") {
                if let Some(id) = blip
                    .child("a:blip")
                    .and_then(|b| b.attr("r:embed"))
                    .and_then(|r| self.asset(part, r, place))
                {
                    out.decorations.push(Placed {
                        asset_id: id,
                        x: rect.0,
                        y: rect.1,
                        w: rect.2,
                        h: rect.3,
                        crop: Self::crop(blip),
                        opacity: None,
                    });
                    self.note("supported", "picture", Some(place), None);
                }
            } else {
                self.note("unsupported", "shapedPicture", Some(place), None);
            }
            return;
        }
        let fill = sp_pr.and_then(|p| p.children.iter().find(|c| c.name.ends_with("Fill")));
        let filled = fill.is_some_and(|f| f.name != "a:noFill");
        if (custom || (geometry.is_some_and(|g| g != "rect") && (filled || text.is_empty())))
            && (filled || n.child("p:txBody").is_none() || text.is_empty())
        {
            self.note("unsupported", "customShape", Some(place), geometry);
            if text.is_empty() {
                return;
            }
        }
        let outlined = sp_pr
            .and_then(|p| p.child("a:ln"))
            .is_some_and(|l| l.child("a:solidFill").is_some());
        if (filled || outlined) && geometry == Some("rect") && !custom {
            let (color, alpha) = match fill {
                Some(f) if f.name == "a:solidFill" => match self.colors().solid(f) {
                    Some((c, a)) => (Some(c), a),
                    None => (None, 1.0),
                },
                Some(f) if f.name == "a:gradFill" => {
                    self.note("unsupported", "gradientShape", Some(place), None);
                    (None, 1.0)
                }
                _ => (None, 1.0),
            };
            let line = sp_pr.and_then(|p| p.child("a:ln"));
            let line_color = line
                .and_then(|l| l.child("a:solidFill"))
                .and_then(|f| self.colors().solid(f))
                .map(|c| c.0);
            let line_width = line.and_then(|l| l.num("w")).unwrap_or(12_700.0) / EMU_PER_POINT;
            if color.is_some() || line_color.is_some() {
                out.rects.push(FilledRect {
                    x: rect.0,
                    y: rect.1,
                    w: rect.2,
                    h: rect.3,
                    fill: color,
                    fill_opacity: (alpha < 1.0).then_some(alpha),
                    line: line_color,
                    line_width,
                });
                self.note("supported", "band", Some(place), None);
            }
            self.effects(sp_pr, place);
        }
        if !text.is_empty() {
            let colors = self.colors();
            let mut props = TextProps::default();
            let body = n.child("p:txBody");
            // A fixed text's own formatting is in its first run.
            if let Some(r) = body
                .and_then(|b| b.child("a:p"))
                .and_then(|p| p.child("a:r"))
                .and_then(|r| r.child("a:rPr"))
            {
                let wrapper = Node {
                    name: "a:lvl1pPr".into(),
                    children: vec![Node {
                        name: "a:defRPr".into(),
                        ..r.clone()
                    }],
                    ..Default::default()
                };
                props.under(Some(&wrapper), &colors);
            }
            props.under(
                body.and_then(|b| b.child("a:p"))
                    .and_then(|p| p.child("a:pPr")),
                &colors,
            );
            props.under(
                body.and_then(|b| b.path(&["a:lstStyle", "a:lvl1pPr"])),
                &colors,
            );
            let mut bp = BodyProps::default();
            bp.under(body.and_then(|b| b.child("a:bodyPr")));
            let frame = self.frame(rect, &props, &bp, 18.0, place);
            out.labels.push(Footer { text, frame });
            self.note("supported", "fixedText", Some(place), None);
        }
    }

    fn picture(&mut self, part: &str, n: &Node, t: Transform, place: &str, out: &mut RoleLayout) {
        let sp_pr = n.child("p:spPr");
        let Some(rect) = xfrm(sp_pr) else { return };
        let x = sp_pr.and_then(|p| p.child("a:xfrm"));
        if x.is_some_and(|x| {
            x.num("rot").unwrap_or(0.0) != 0.0
                || x.attr("flipH") == Some("1")
                || x.attr("flipV") == Some("1")
        }) {
            self.note("unsupported", "rotatedPicture", Some(place), None);
            return;
        }
        if n.path(&["p:nvPicPr", "p:nvPr"]).is_some_and(|p| {
            p.children
                .iter()
                .any(|c| c.local() == "videoFile" || c.local() == "audioFile")
        }) {
            self.note("unsupported", "media", Some(place), None);
            return;
        }
        let geometry = sp_pr
            .and_then(|p| p.child("a:prstGeom"))
            .and_then(|g| g.attr("prst"))
            .unwrap_or("rect");
        if geometry != "rect" {
            self.note("unsupported", "shapedPicture", Some(place), Some(geometry));
            return;
        }
        let Some(blip_fill) = n.child("p:blipFill") else {
            return;
        };
        let Some(blip) = blip_fill.child("a:blip") else {
            return;
        };
        let svg = blip.path(&["a:extLst"]).is_some_and(|e| {
            e.children
                .iter()
                .any(|x| x.children.iter().any(|y| y.local() == "svgBlip"))
        });
        let Some(id) = blip
            .attr("r:embed")
            .and_then(|r| self.asset(part, r, place))
        else {
            return;
        };
        if svg {
            self.note("attention", "svgAsPicture", Some(place), None);
        }
        let opacity = blip
            .child("a:alphaModFix")
            .and_then(|a| a.num("amt"))
            .map(|a| a / 100_000.0);
        let rect = t.apply(rect);
        out.decorations.push(Placed {
            asset_id: id,
            x: rect.0,
            y: rect.1,
            w: rect.2,
            h: rect.3,
            crop: Self::crop(blip_fill),
            opacity,
        });
        self.effects(sp_pr, place);
        self.note("supported", "picture", Some(place), None);
    }

    /// A text box from gathered properties.
    fn frame(
        &mut self,
        (x, y, w, h): (f32, f32, f32, f32),
        p: &TextProps,
        b: &BodyProps,
        default_size: f32,
        place: &str,
    ) -> TextFrame {
        let size = p.size.unwrap_or(default_size).clamp(4.0, 400.0);
        let font_family = match p.font.as_deref() {
            Some("+mj-lt") | Some("+mj-ea") => self.theme.major.clone(),
            Some("+mn-lt") | Some("+mn-ea") | None => self.theme.minor.clone(),
            Some(f) => f.to_string(),
        };
        // The theme's own fonts stay linked to the template's heading and body
        // fonts (so a replacement applies everywhere); when both are the same
        // family, the theme reference decides.
        let font = match p.font.as_deref() {
            Some("+mj-lt") | Some("+mj-ea") => "heading".to_string(),
            Some("+mn-lt") | Some("+mn-ea") | None => "body".to_string(),
            _ if font_family.eq_ignore_ascii_case(&self.theme.minor) => "body".to_string(),
            _ if font_family.eq_ignore_ascii_case(&self.theme.major)
                && !self.theme.major.is_empty() =>
            {
                "heading".to_string()
            }
            _ => font_family.clone(),
        };
        let bold = p.bold.unwrap_or(false);
        let italic = p.italic.unwrap_or(false);
        self.use_font(&font_family, bold, italic, place);
        let align = match p.align.as_deref() {
            Some("ctr") => "center",
            Some("r") => "right",
            Some("just") | Some("dist") => {
                self.note("attention", "justified", Some(place), None);
                "left"
            }
            _ => "left",
        };
        let valign = match b.anchor.as_deref() {
            Some("ctr") => "middle",
            Some("b") => "bottom",
            _ => "top",
        };
        let fit = match b.fit.as_deref() {
            Some("shrink") => "shrink",
            Some("grow") => {
                self.note("attention", "growsWithText", Some(place), None);
                "none"
            }
            _ => "none",
        };
        if b.vertical {
            self.note("unsupported", "verticalText", Some(place), None);
        }
        if b.no_wrap {
            self.note("attention", "noWrap", Some(place), None);
        }
        let line_spacing = match p.line_spacing {
            Some(v) if v > 0.0 => v,
            // Exact spacing in points becomes a multiple of the size.
            Some(v) => (-v / size).max(0.5),
            None => 1.2,
        };
        let inset = [
            b.insets[0].unwrap_or(7.2),
            b.insets[1].unwrap_or(3.6),
            b.insets[2].unwrap_or(7.2),
            b.insets[3].unwrap_or(3.6),
        ];
        TextFrame {
            x,
            y,
            w,
            h,
            font,
            size,
            min_size: if fit == "shrink" {
                (size * 0.4).max(12.0).min(size)
            } else {
                size
            },
            bold,
            italic,
            color: p.color.clone().unwrap_or_else(|| "text".into()),
            align: align.into(),
            valign: valign.into(),
            inset,
            line_spacing,
            fit: fit.into(),
        }
    }
}

/// The master's text styles for a placeholder type.
fn master_style<'a>(master: &'a Node, kind: &str) -> Option<&'a Node> {
    let styles = master.child("p:txStyles")?;
    let style = if is_title(kind) {
        styles.child("p:titleStyle")
    } else if matches!(kind, "body" | "obj" | "subTitle" | "tx") {
        styles.child("p:bodyStyle")
    } else {
        styles.child("p:otherStyle")
    }?;
    style.child("a:lvl1pPr")
}

fn same_ph(a: &Ph, kind: &str, idx: Option<&str>) -> bool {
    fn norm(k: &str) -> &str {
        match k {
            "ctrTitle" => "title",
            "subTitle" | "obj" | "tx" => "body",
            k => k,
        }
    }
    norm(&a.kind) == norm(kind) && (a.idx.as_deref() == idx || idx.is_none() || a.idx.is_none())
}

/// How a slide size reads: "16:9", "4:3", "16:10" or "other".
pub fn ratio(width: f32, height: f32) -> String {
    let r = width / height.max(1.0);
    [
        (16.0 / 9.0, "16:9"),
        (4.0 / 3.0, "4:3"),
        (16.0 / 10.0, "16:10"),
    ]
    .iter()
    .find(|(v, _)| (r - v).abs() < 0.01)
    .map_or("other", |(_, n)| *n)
    .to_string()
}

/// Weight and style words a family name may carry ("Montserrat SemiBold").
const STYLE_WORDS: &[&str] = &[
    "thin",
    "hairline",
    "extralight",
    "ultralight",
    "light",
    "book",
    "regular",
    "normal",
    "medium",
    "semibold",
    "demibold",
    "bold",
    "extrabold",
    "ultrabold",
    "black",
    "heavy",
    "italic",
    "oblique",
    "condensed",
    "narrow",
];

/// An installed family that looks like the one asked for, offered (never applied).
fn suggestion(faces: &[CatalogFace], family: &str) -> Option<String> {
    let installed = |name: &str| {
        font_catalog::status(faces, name, false, false) != FontStatus::Missing
            || font_catalog::status(faces, name, true, false) != FontStatus::Missing
    };
    let words: Vec<&str> = family.split_whitespace().collect();
    let mut base: Vec<&str> = words.clone();
    while base
        .last()
        .is_some_and(|w| STYLE_WORDS.contains(&w.to_lowercase().as_str()))
    {
        base.pop();
    }
    if !base.is_empty() && base.len() < words.len() {
        let name = base.join(" ");
        if installed(&name) {
            return Some(name);
        }
    }
    // Metric-compatible families, where installed.
    let alike: &[(&str, &[&str])] = &[
        ("calibri", &["Carlito"]),
        ("cambria", &["Caladea"]),
        ("arial", &["Liberation Sans", "Arimo"]),
        ("helvetica", &["Arial", "Liberation Sans"]),
        ("helvetica neue", &["Helvetica", "Arial", "Liberation Sans"]),
        ("times new roman", &["Liberation Serif", "Tinos"]),
        ("courier new", &["Liberation Mono", "Cousine"]),
    ];
    let key = base.join(" ").to_lowercase();
    alike
        .iter()
        .find(|(k, _)| *k == key)
        .and_then(|(_, list)| list.iter().find(|n| installed(n)).map(|s| s.to_string()))
}

/// Roles each source layout is suggested for: only where obvious.
fn suggest(layouts: &[SourceLayout]) -> BTreeMap<String, String> {
    let words: &[(&str, &[&str])] = &[
        (
            "scripture",
            &[
                "verse",
                "bible",
                "scripture",
                "bibel",
                "vers",
                "성경",
                "말씀",
                "verset",
                "versículo",
                "versiculo",
                "escritura",
                "bíblia",
                "passage",
            ],
        ),
        (
            "quote",
            &["quote", "zitat", "citation", "cita", "citação", "인용"],
        ),
        (
            "question",
            &["question", "frage", "pregunta", "pergunta", "질문"],
        ),
        (
            "image",
            &[
                "photo", "picture", "image", "bild", "foto", "사진", "imagem", "imagen",
            ],
        ),
        (
            "section",
            &[
                "section",
                "abschnitt",
                "sección",
                "seção",
                "구역",
                "간지",
                "divider",
            ],
        ),
    ];
    let mut out = BTreeMap::new();
    let mut put = |role: &str, id: &str| {
        out.entry(role.to_string())
            .or_insert_with(|| id.to_string());
    };
    for l in layouts {
        let name = l.name.to_lowercase();
        for (role, list) in words {
            if list.iter().any(|w| name.contains(w)) {
                put(role, &l.id);
            }
        }
    }
    for l in layouts {
        match l.kind.as_str() {
            "title" => put("title", &l.id),
            "secHead" => put("section", &l.id),
            "pic" | "picTx" => put("image", &l.id),
            "blank" => put("pause", &l.id),
            "obj" | "tx" => {
                for role in ["heading", "text", "question", "custom"] {
                    put(role, &l.id);
                }
            }
            _ => {}
        }
    }
    // A suggestion needs a box for what that kind of slide shows.
    out.retain(|role, id| {
        let Some(l) = layouts.iter().find(|l| &l.id == id) else {
            return false;
        };
        let l = &l.layout;
        match role.as_str() {
            "pause" => true,
            "image" => l.image.is_some(),
            "scripture" | "quote" => l.body.is_some(),
            _ => l.title.is_some() || l.body.is_some(),
        }
    });
    out
}

/// Reads a church's PowerPoint design. Its pictures are kept in `store`.
pub fn import(
    bytes: &[u8],
    file_name: &str,
    store: &TemplateStore,
    faces: &[CatalogFace],
    progress: &dyn Fn(usize, usize),
) -> AppResult<ImportedTemplate> {
    let pkg = Package::open(bytes)?;
    let presentation = pkg
        .xml("ppt/presentation.xml")
        .ok_or_else(not_a_presentation)?;
    let size = presentation.child("p:sldSz");
    let width = size.and_then(|s| s.num("cx")).unwrap_or(9_144_000.0) / EMU_PER_POINT;
    let height = size.and_then(|s| s.num("cy")).unwrap_or(6_858_000.0) / EMU_PER_POINT;
    if !(100.0..=4000.0).contains(&width) || !(100.0..=4000.0).contains(&height) {
        return Err(not_a_presentation());
    }
    let rels = pkg.rels("ppt/presentation.xml");
    let slides = presentation
        .child("p:sldIdLst")
        .map_or(0, |l| l.children.len());
    let mut masters: Vec<String> = presentation
        .child("p:sldMasterIdLst")
        .map(|l| {
            l.children
                .iter()
                .filter_map(|m| m.attr("r:id"))
                .filter_map(|id| rels.get(id).map(|(_, t)| t.clone()))
                .collect()
        })
        .unwrap_or_default();
    masters.dedup();
    if masters.is_empty() {
        return Err(not_a_presentation());
    }
    let mut reader = Reader {
        pkg: &pkg,
        store,
        items: BTreeMap::new(),
        assets: Vec::new(),
        media: HashMap::new(),
        fonts: Vec::new(),
        theme: Theme::default(),
        map: HashMap::new(),
    };
    if presentation.child("p:embeddedFontLst").is_some() {
        reader.note("attention", "embeddedFonts", None, None);
    }
    if slides > 0 {
        reader.note(
            "supported",
            "slidesIgnored",
            None,
            Some(&slides.to_string()),
        );
    }
    let name = pkg
        .xml("docProps/core.xml")
        .and_then(|c| {
            c.children
                .iter()
                .find(|x| x.local() == "title")
                .map(|t| t.text.trim().to_string())
        })
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            file_name
                .rsplit_once('.')
                .map_or(file_name, |(n, _)| n)
                .trim()
                .to_string()
        });

    let mut layouts: Vec<SourceLayout> = Vec::new();
    let mut first: Option<(Theme, HashMap<String, String>, Option<Background>)> = None;
    let total_layouts: usize = masters
        .iter()
        .map(|m| {
            pkg.xml(m)
                .and_then(|x| x.child("p:sldLayoutIdLst").map(|l| l.children.len()))
                .unwrap_or(0)
        })
        .sum();
    let mut done = 0;
    for (mi, master_part) in masters.iter().enumerate() {
        let Some(master) = pkg.xml(master_part) else {
            continue;
        };
        let mrels = pkg.rels(master_part);
        let theme_part = mrels
            .values()
            .find(|(k, _)| k == "theme")
            .map(|(_, t)| t.clone());
        reader.theme = theme_part
            .and_then(|t| pkg.xml(&t))
            .map(|t| theme(&t))
            .unwrap_or_default();
        reader.map = clr_map(&master);
        let master_place = if masters.len() > 1 {
            format!("Master {}", mi + 1)
        } else {
            "Master".to_string()
        };
        let Some(m_csld) = master.child("p:cSld") else {
            continue;
        };
        let master_bg = reader.background(master_part, m_csld, &master_place);
        let mut master_shapes = RoleLayout::default();
        let mut master_phs = Vec::new();
        if let Some(tree) = m_csld.child("p:spTree") {
            reader.shapes(
                master_part,
                tree,
                Transform::ID,
                &master_place,
                &mut master_shapes,
                &mut master_phs,
            );
        }
        if first.is_none() {
            first = Some((reader.theme.clone(), reader.map.clone(), master_bg.clone()));
        }
        let layout_ids: Vec<String> = master
            .child("p:sldLayoutIdLst")
            .map(|l| {
                l.children
                    .iter()
                    .filter_map(|x| x.attr("r:id"))
                    .filter_map(|id| mrels.get(id).map(|(_, t)| t.clone()))
                    .collect()
            })
            .unwrap_or_default();
        for layout_part in layout_ids {
            done += 1;
            progress(done, total_layouts.max(done));
            let Some(layout) = pkg.xml(&layout_part) else {
                continue;
            };
            let Some(csld) = layout.child("p:cSld") else {
                continue;
            };
            let lname = csld.attr("name").unwrap_or("Layout").to_string();
            let kind = layout.attr("type").unwrap_or("cust").to_string();
            let mut out = RoleLayout {
                source: Some(lname.clone()),
                ..Default::default()
            };
            out.background = reader
                .background(&layout_part, csld, &lname)
                .or_else(|| master_bg.clone());
            if layout.attr("showMasterSp") != Some("0") {
                out.decorations
                    .extend(master_shapes.decorations.iter().cloned());
                out.rects.extend(master_shapes.rects.iter().cloned());
                out.labels.extend(master_shapes.labels.iter().cloned());
            }
            let mut phs = Vec::new();
            if let Some(tree) = csld.child("p:spTree") {
                let mut own = RoleLayout::default();
                reader.shapes(
                    &layout_part,
                    tree,
                    Transform::ID,
                    &lname,
                    &mut own,
                    &mut phs,
                );
                out.decorations.extend(own.decorations);
                out.rects.extend(own.rects);
                out.labels.extend(own.labels);
            }
            // Placeholders, in reading order, each with what it inherits from the master.
            phs.sort_by(|a, b| {
                let ay = a.rect.map_or(f32::MAX, |r| r.1);
                let by = b.rect.map_or(f32::MAX, |r| r.1);
                ay.partial_cmp(&by).unwrap_or(std::cmp::Ordering::Equal)
            });
            for ph in &phs {
                let inherited = master_phs
                    .iter()
                    .find(|m| same_ph(m, &ph.kind, ph.idx.as_deref()));
                let rect = ph.rect.or_else(|| inherited.and_then(|m| m.rect));
                let Some(rect) = rect else { continue };
                let colors = reader.colors();
                let mut props = TextProps::default();
                props.under(
                    ph.node.path(&["p:txBody", "a:lstStyle", "a:lvl1pPr"]),
                    &colors,
                );
                if let Some(m) = inherited {
                    props.under(
                        m.node.path(&["p:txBody", "a:lstStyle", "a:lvl1pPr"]),
                        &colors,
                    );
                }
                props.under(master_style(&master, &ph.kind), &colors);
                props.under(
                    presentation.path(&["p:defaultTextStyle", "a:lvl1pPr"]),
                    &colors,
                );
                let mut bp = BodyProps::default();
                bp.under(ph.node.path(&["p:txBody", "a:bodyPr"]));
                if let Some(m) = inherited {
                    bp.under(m.node.path(&["p:txBody", "a:bodyPr"]));
                }
                let default_size = if is_title(&ph.kind) { 44.0 } else { 28.0 };
                match ph.kind.as_str() {
                    k if is_title(k) => {
                        if out.title.is_none() {
                            out.title = Some(reader.frame(rect, &props, &bp, default_size, &lname));
                        }
                    }
                    "body" | "obj" | "subTitle" | "tx" => {
                        if out.body.is_none() {
                            out.body = Some(reader.frame(rect, &props, &bp, default_size, &lname));
                        } else if out.reference.is_none()
                            && kind != "twoObj"
                            && kind != "twoTxTwoObj"
                        {
                            // A second text box (smaller, under the title) holds the passage line.
                            // Whichever of the two is smaller; the other is the body.
                            let f = reader.frame(rect, &props, &bp, default_size, &lname);
                            if out.body.as_ref().is_some_and(|b| f.h < b.h) {
                                out.reference = Some(f);
                            } else {
                                out.reference = out.body.replace(f);
                            }
                        } else {
                            reader.note("attention", "extraTextBox", Some(&lname), None);
                        }
                    }
                    "pic" => {
                        if out.image.is_none() {
                            out.image = Some(Frame {
                                x: rect.0,
                                y: rect.1,
                                w: rect.2,
                                h: rect.3,
                            });
                            reader.note("supported", "imageArea", Some(&lname), None);
                        }
                    }
                    "ftr" => {
                        let text = ph
                            .node
                            .child("p:txBody")
                            .map(Node::all_text)
                            .filter(|t| !t.is_empty())
                            .or_else(|| {
                                inherited
                                    .and_then(|m| m.node.child("p:txBody"))
                                    .map(Node::all_text)
                            })
                            .unwrap_or_default();
                        if !text.is_empty() {
                            let frame = reader.frame(rect, &props, &bp, 12.0, &lname);
                            out.labels.push(Footer { text, frame });
                            reader.note("supported", "footer", Some(&lname), None);
                        }
                    }
                    "dt" | "sldNum" | "hdr" => {}
                    "tbl" | "chart" | "dgm" | "media" | "clipArt" => {
                        reader.note(
                            "unsupported",
                            "contentPlaceholder",
                            Some(&lname),
                            Some(&ph.kind),
                        );
                    }
                    _ => {}
                }
            }
            if out.title.is_some() || out.body.is_some() {
                reader.note("supported", "textBoxes", Some(&lname), None);
            }
            layouts.push(SourceLayout {
                id: layout_part
                    .rsplit('/')
                    .next()
                    .unwrap_or(&layout_part)
                    .trim_end_matches(".xml")
                    .to_string(),
                name: lname,
                kind,
                layout: out,
            });
        }
    }
    // Layouts with the same name in several masters are told apart.
    let mut seen: HashMap<String, usize> = HashMap::new();
    for l in &mut layouts {
        let n = seen.entry(l.name.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            l.name = format!("{} ({})", l.name, n);
        }
    }

    let (th, map, master_bg) = first.unwrap_or_default();
    reader.theme = th.clone();
    reader.map = map.clone();
    let pick = |name: &str, fallback: &str| -> String {
        let mapped = map.get(name).map(String::as_str).unwrap_or(name);
        th.colors
            .get(mapped)
            .cloned()
            .unwrap_or_else(|| fallback.to_string())
    };
    let background_color = master_bg
        .as_ref()
        .and_then(|b| b.color.clone())
        .unwrap_or_else(|| pick("bg1", "#FFFFFF"));
    let mut others: Vec<FontChoice> = Vec::new();
    for l in &layouts {
        for f in [&l.layout.title, &l.layout.reference, &l.layout.body]
            .into_iter()
            .flatten()
            .chain(l.layout.labels.iter().map(|x| &x.frame))
        {
            if f.font != "heading"
                && f.font != "body"
                && !others
                    .iter()
                    .any(|o| o.family.eq_ignore_ascii_case(&f.font))
            {
                others.push(FontChoice {
                    family: f.font.clone(),
                    replacement: None,
                });
            }
        }
    }
    reader.use_font(&th.major.clone(), true, false, "heading");
    reader.use_font(&th.minor.clone(), false, false, "body");
    let definition = TemplateDefinition {
        width,
        height,
        colors: TemplateColors {
            background: background_color,
            text: pick("tx1", "#1D1B18"),
            muted: pick("tx2", "#55504A"),
            accent: pick("accent1", "#2F5D50"),
        },
        fonts: TemplateFonts {
            heading: FontChoice {
                family: th.major.clone(),
                replacement: None,
            },
            body: FontChoice {
                family: th.minor.clone(),
                replacement: None,
            },
            others,
        },
        background: master_bg.unwrap_or_default(),
        assets: reader.assets.clone(),
        ..TemplateDefinition::default()
    };

    // Fonts: installed, without the wanted style, or missing — and the boxes whose wrapping may differ.
    let mut fonts = Vec::new();
    for u in &reader.fonts {
        let status = font_catalog::status(faces, &u.family, u.bold, u.italic);
        let face = font_catalog::find(faces, &u.family, u.bold, u.italic);
        fonts.push(FontReport {
            family: u.family.clone(),
            bold: u.bold,
            italic: u.italic,
            status,
            embeddable: face.is_some_and(|f| f.embeddable),
            suggestion: (status != FontStatus::Installed)
                .then(|| suggestion(faces, &u.family))
                .flatten(),
            used_in: u.used_in.clone(),
        });
    }
    let mut extra: Vec<(String, String, Option<String>, Option<String>)> = Vec::new();
    for f in &fonts {
        let code = match f.status {
            FontStatus::Installed if !f.embeddable => Some(("attention", "fontNotEmbeddable")),
            FontStatus::Installed => None,
            FontStatus::StyleMissing => Some(("attention", "fontStyleMissing")),
            FontStatus::Missing => Some(("attention", "fontMissing")),
        };
        if let Some((level, code)) = code {
            extra.push((level.into(), code.into(), None, Some(f.family.clone())));
        }
        if f.status != FontStatus::Installed {
            for place in f.used_in.iter().filter(|p| *p != "heading" && *p != "body") {
                extra.push((
                    "attention".into(),
                    "wrapRisk".into(),
                    Some(place.clone()),
                    Some(f.family.clone()),
                ));
            }
        }
    }
    for e in extra {
        *reader.items.entry(e).or_insert(0) += 1;
    }
    let items: Vec<ReportItem> = reader
        .items
        .iter()
        .map(|((level, code, layout, detail), count)| ReportItem {
            level: level.clone(),
            code: code.clone(),
            layout: layout.clone(),
            detail: detail.clone(),
            count: *count,
        })
        .collect();
    let suggestions = suggest(&layouts);
    Ok(ImportedTemplate {
        name,
        definition,
        report: Report {
            file_name: file_name.to_string(),
            width,
            height,
            ratio: ratio(width, height),
            masters: masters.len(),
            layouts: layouts.len(),
            slides,
            fonts,
            items,
        },
        layouts,
        suggestions,
    })
}

impl ImportedTemplate {
    /// The design as accepted: each role laid out as the source layout chosen
    /// for it (`mapping`: role → layout id; a role left out uses the built-in
    /// arrangement), keeping only the images that are still used.
    pub fn accept(&self, mapping: &BTreeMap<String, String>) -> TemplateDefinition {
        let mut def = self.definition.clone();
        def.roles = mapping
            .iter()
            .filter(|(role, _)| template::ROLES.contains(&role.as_str()))
            .filter_map(|(role, id)| {
                self.layouts
                    .iter()
                    .find(|l| &l.id == id)
                    .map(|l| (role.clone(), l.layout.clone()))
            })
            .collect();
        let used: Vec<String> = def.used_assets().iter().map(|s| s.to_string()).collect();
        def.assets.retain(|a| used.contains(&a.id));
        def
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relationship_targets_resolve_against_their_folder() {
        assert_eq!(
            resolve("ppt/slideMasters", "../theme/theme1.xml"),
            "ppt/theme/theme1.xml"
        );
        assert_eq!(
            resolve("ppt", "slideMasters/slideMaster1.xml"),
            "ppt/slideMasters/slideMaster1.xml"
        );
        assert_eq!(
            resolve("ppt/slideLayouts", "/ppt/media/a.png"),
            "ppt/media/a.png"
        );
    }

    #[test]
    fn theme_colour_changes_follow_office() {
        let theme = Theme {
            colors: [("accent1".to_string(), "#4472C4".to_string())]
                .into_iter()
                .collect(),
            ..Default::default()
        };
        let map = HashMap::new();
        let c = Colors {
            theme: &theme,
            map: &map,
        };
        let n = parse(
            br#"<a:schemeClr xmlns:a="x" val="accent1"><a:lumMod val="75000"/></a:schemeClr>"#,
        )
        .unwrap();
        // PowerPoint shows accent 1, darker 25 % as #2F5597.
        assert_eq!(c.of(&n, None).unwrap().0, "#2F5597");
        let n = parse(br#"<a:srgbClr xmlns:a="x" val="ff0000"><a:alpha val="40000"/></a:srgbClr>"#)
            .unwrap();
        assert_eq!(c.of(&n, None).unwrap(), ("#FF0000".to_string(), 0.4));
    }

    #[test]
    fn sizes_are_named_by_their_proportions() {
        assert_eq!(ratio(960.0, 540.0), "16:9");
        assert_eq!(ratio(720.0, 405.0), "16:9");
        assert_eq!(ratio(720.0, 540.0), "4:3");
        assert_eq!(ratio(864.0, 540.0), "16:10");
        assert_eq!(ratio(612.0, 792.0), "other");
    }
}
