//! DOCX: the text a Word document says (for Reading, search and citing) and
//! the structure the formatted view draws (see `docx_view`).
//!
//! A DOCX is a zip of XML parts. Nothing here runs or opens anything: the
//! parts that matter are read from the managed file, parsed with a pull
//! parser into a small model (paragraphs, runs, lists, tables, notes), and
//! every other element, macro, embedded object, field and external
//! relationship is ignored. The interface never sees the package; it gets
//! the typed tree `docx_view` builds from this model.
//!
//! One walk of the model, in document order, decides everything that has to
//! agree between Reading and Original: which paragraph is which segment of
//! the extracted text, which heading starts which part, and where each
//! bookmark and note lives. Import and the formatted view both use it, so
//! they cannot drift apart.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use super::epub::{read_entry, unescape};
use super::epub_view::safe_external_url;
use super::{
    language_name, split_long, ExtractionStatus, FoundMetadata, ImportedDocument, NewSegment,
    SourceImportAdapter,
};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::contents::{clean_title, ContentsItem, ContentsTarget, MAX_DEPTH, MAX_ITEMS};

pub struct DocxImporter;

/// The longest passage kept as one segment (as for EPUB).
const MAX_SEGMENT: usize = 1_500;
/// Most paragraphs read from one document, and deepest nesting of tables.
const MAX_PARAGRAPHS: usize = 250_000;
const MAX_TABLE_DEPTH: usize = 6;
const MAX_ID_CHARS: usize = 200;
/// How many top-level blocks make one part of the formatted view.
const PART_WEIGHT: usize = 600;
const PART_WEIGHT_AT_HEADING: usize = 120;

impl SourceImportAdapter for DocxImporter {
    fn format(&self) -> &'static str {
        "docx"
    }

    fn accepts(&self, extension: &str) -> bool {
        extension == "docx"
    }

    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument> {
        let doc = read_docx(bytes, file_name)?;
        Ok(ImportedDocument {
            format: "docx",
            metadata: doc.metadata.clone(),
            chapter_count: Some(doc.chapters),
            segments: doc.segments,
            extraction_status: ExtractionStatus::DigitalText,
            page_count: None,
        })
    }
}

/// The document's headings as a nested tree of internal targets (the segment
/// each leads to). Empty when the text no longer matches what was imported.
pub fn contents(bytes: &[u8], expected_segments: usize) -> Vec<ContentsItem> {
    match read_docx(bytes, "document.docx") {
        Ok(doc) if doc.segments.len() == expected_segments => nest(&doc.headings),
        _ => Vec::new(),
    }
}

/// The parts of the formatted view and where each starts among the
/// extracted segments (the same shape as for an EPUB's documents). Empty
/// when the text no longer matches what was imported.
pub fn structure(bytes: &[u8], expected_segments: usize) -> Vec<super::epub_view::StructureItem> {
    let Ok(doc) = read_docx(bytes, "document.docx") else {
        return Vec::new();
    };
    if doc.segments.len() != expected_segments {
        return Vec::new();
    }
    let total = doc.segments.len();
    let last = total.saturating_sub(1);
    // Each part's ids, gathered in one pass (index `parts.len()` is the notes).
    let mut anchors: Vec<std::collections::BTreeMap<String, i64>> =
        vec![Default::default(); doc.parts.len() + 1];
    for m in &doc.marks {
        let slot = m.part.unwrap_or(doc.parts.len());
        anchors[slot].insert(m.id.clone(), m.segment.min(last) as i64);
    }
    let mut anchors = anchors.into_iter();
    let mut out = Vec::with_capacity(doc.parts.len() + 1);
    for (index, part) in doc.parts.iter().enumerate() {
        let end = doc
            .parts
            .get(index + 1)
            .map(|p| p.first_segment)
            .or_else(|| doc.notes_part.as_ref().map(|n| n.first_segment))
            .unwrap_or(total);
        out.push(super::epub_view::StructureItem {
            id: part.id.clone(),
            start_segment: part.first_segment as i64,
            segment_count: end.saturating_sub(part.first_segment) as i64,
            anchors: anchors.next().unwrap_or_default(),
        });
    }
    if let Some(notes) = &doc.notes_part {
        out.push(super::epub_view::StructureItem {
            id: NOTES_PART.to_string(),
            start_segment: notes.first_segment as i64,
            segment_count: total.saturating_sub(notes.first_segment) as i64,
            anchors: anchors.next().unwrap_or_default(),
        });
    }
    out
}

pub const NOTES_PART: &str = "notes";

fn nest(headings: &[Heading]) -> Vec<ContentsItem> {
    struct Frame {
        level: u8,
        item: ContentsItem,
    }
    fn close(stack: &mut Vec<Frame>, roots: &mut Vec<ContentsItem>) {
        if let Some(done) = stack.pop() {
            match stack.last_mut() {
                Some(parent) => parent.item.children.push(done.item),
                None => roots.push(done.item),
            }
        }
    }
    let mut roots = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    for (n, h) in headings.iter().take(MAX_ITEMS).enumerate() {
        while stack.last().is_some_and(|f| f.level >= h.level) {
            close(&mut stack, &mut roots);
        }
        // Nesting deeper than the limit is flattened to the deepest level kept.
        if stack.len() >= MAX_DEPTH {
            close(&mut stack, &mut roots);
        }
        stack.push(Frame {
            level: h.level,
            item: ContentsItem {
                id: format!("n{n}"),
                title: clean_title(&h.title),
                target: Some(ContentsTarget::Segment {
                    position: h.segment as i64,
                }),
                children: Vec::new(),
            },
        });
    }
    while !stack.is_empty() {
        close(&mut stack, &mut roots);
    }
    roots
}

// --- the model ---------------------------------------------------------------

/// Character formatting after styles are applied.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Fmt {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub sup: bool,
    pub sub: bool,
    pub caps: bool,
    pub small_caps: bool,
    pub highlight: bool,
    pub mono: bool,
    pub hidden: bool,
    /// Half-points.
    pub size: Option<u32>,
    pub color: Option<String>,
}

/// Character properties as written: only what a level of the cascade says.
#[derive(Debug, Clone, Default)]
struct RProps {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    caps: Option<bool>,
    small_caps: Option<bool>,
    highlight: Option<bool>,
    mono: Option<bool>,
    hidden: Option<bool>,
    /// 1 superscript, -1 subscript, 0 baseline.
    vert: Option<i8>,
    size: Option<u32>,
    /// Empty: automatic.
    color: Option<String>,
    style: Option<String>,
}

impl RProps {
    fn over(&mut self, o: &RProps) {
        macro_rules! take {
            ($($f:ident),*) => { $( if o.$f.is_some() { self.$f = o.$f.clone(); } )* };
        }
        take!(
            bold, italic, underline, strike, caps, small_caps, highlight, mono, hidden, vert, size,
            color
        );
    }

    fn fmt(&self) -> Fmt {
        Fmt {
            bold: self.bold.unwrap_or(false),
            italic: self.italic.unwrap_or(false),
            underline: self.underline.unwrap_or(false),
            strike: self.strike.unwrap_or(false),
            sup: self.vert == Some(1),
            sub: self.vert == Some(-1),
            caps: self.caps.unwrap_or(false),
            small_caps: self.small_caps.unwrap_or(false),
            highlight: self.highlight.unwrap_or(false),
            mono: self.mono.unwrap_or(false),
            hidden: self.hidden.unwrap_or(false),
            size: self.size,
            color: self.color.clone().filter(|c| !c.is_empty()),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct PProps {
    style: Option<String>,
    jc: Option<String>,
    ind_left: Option<i32>,
    ind_right: Option<i32>,
    /// First line (positive) or hanging (negative), twips.
    first: Option<i32>,
    before: Option<i32>,
    after: Option<i32>,
    /// A line spacing "auto" multiple, in 240ths.
    line: Option<i32>,
    bidi: Option<bool>,
    num_id: Option<i64>,
    ilvl: Option<usize>,
    outline: Option<u8>,
    page_break_before: bool,
    bottom_rule: bool,
    /// A section ends with this paragraph: its break type.
    section: Option<String>,
}

impl PProps {
    fn over(&mut self, o: &PProps) {
        macro_rules! take {
            ($($f:ident),*) => { $( if o.$f.is_some() { self.$f = o.$f.clone(); } )* };
        }
        take!(
            jc, ind_left, ind_right, first, before, after, line, bidi, num_id, ilvl, outline,
            section
        );
        self.page_break_before |= o.page_break_before;
        self.bottom_rule |= o.bottom_rule;
    }
}

#[derive(Debug, Clone, Default)]
struct StyleDef {
    name: String,
    based_on: Option<String>,
    ppr: PProps,
    rpr: RProps,
    default: bool,
    character: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ImageRef {
    pub rid: String,
    /// Pixels at 96 dpi, as the document sizes it.
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub alt: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Inline {
    Text(String, Fmt),
    Br,
    Image(ImageRef),
    /// A footnote (false) or endnote (true) reference, by the note's id.
    NoteRef(bool, i64),
    Bookmark(String),
    /// Opens a link to a bookmark; ended by `LinkEnd`.
    LinkStart(String),
    /// Opens a link to the web: an address already checked by `safe_external_url`; ended by `LinkEnd`.
    WebStart(String),
    LinkEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Normal,
    Title,
    Quote,
    Code,
    Caption,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ListKind {
    Bullet,
    /// An ordered list: the HTML numbering type ("1", "a", "A", "i", "I").
    Ordered(&'static str),
    /// Numbered with no visible marker.
    Plain,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ListItem {
    pub num_id: i64,
    pub level: usize,
    pub kind: ListKind,
    pub number: i64,
}

#[derive(Debug, Clone)]
pub(super) struct Para {
    pub heading: Option<u8>,
    pub kind: Kind,
    /// Block-level style (`text-align: …`), already safe.
    pub css: String,
    pub rtl: bool,
    pub list: Option<ListItem>,
    pub inlines: Vec<Inline>,
    /// The plain text, whitespace collapsed.
    pub text: String,
    pub break_before: bool,
    pub break_after: bool,
    pub rule: bool,
    /// The segment the paragraph starts at (or the next one, for a heading).
    pub segment: usize,
    /// The element id it carries, when it has one.
    pub id: Option<String>,
    // Parsing only: the pending list reference, resolved by the layout.
    num: Option<(i64, usize)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VMerge {
    None,
    Restart,
    Continue,
}

#[derive(Debug, Clone)]
pub(super) struct Cell {
    pub span: u32,
    pub row_span: u32,
    pub skip: bool,
    pub header: bool,
    pub shade: Option<String>,
    pub blocks: Vec<Block>,
    vmerge: VMerge,
}

#[derive(Debug, Clone)]
pub(super) struct Row {
    pub header: bool,
    pub cells: Vec<Cell>,
}

#[derive(Debug, Clone)]
pub(super) struct Table {
    pub rows: Vec<Row>,
}

#[derive(Debug, Clone)]
pub(super) enum Block {
    Para(Para),
    Table(Table),
}

#[derive(Debug, Clone)]
pub(super) struct Note {
    pub endnote: bool,
    pub id: i64,
    pub label: usize,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone)]
struct Heading {
    level: u8,
    title: String,
    segment: usize,
}

/// A place a link can lead: an element id, the segment it falls in, and the
/// part it is in (None: the notes).
#[derive(Debug, Clone)]
pub(super) struct Mark {
    pub id: String,
    pub segment: usize,
    pub part: Option<usize>,
}

#[derive(Debug, Clone)]
pub(super) struct PartPlan {
    pub id: String,
    /// Top-level blocks `start..end`.
    pub start: usize,
    pub end: usize,
    pub first_segment: usize,
}

#[derive(Debug, Clone)]
pub(super) struct NotesPlan {
    pub first_segment: usize,
}

#[derive(Debug, Clone, Default)]
pub(super) struct Rel {
    pub target: String,
    pub external: bool,
}

pub(super) struct Docx {
    pub metadata: FoundMetadata,
    pub blocks: Vec<Block>,
    pub notes: Vec<Note>,
    pub rels: HashMap<String, Rel>,
    /// Directory the relationship targets are relative to ("word/").
    pub dir: String,
    /// The body text's size, in half-points.
    pub base_size: u32,
    pub segments: Vec<NewSegment>,
    headings: Vec<Heading>,
    pub chapters: u32,
    pub marks: Vec<Mark>,
    pub parts: Vec<PartPlan>,
    pub notes_part: Option<NotesPlan>,
    /// Bookmark name → (element id, part).
    pub bookmarks: HashMap<String, (String, Option<usize>)>,
    /// A note's reference marker: (endnote, id) → (element id, part).
    pub note_refs: HashMap<(bool, i64), (String, Option<usize>)>,
}

// --- reading the package ------------------------------------------------------

fn bad(file_name: &str, why: &str) -> AppError {
    AppError::Import(
        UserMessage::new(
            "library.badDocx",
            format!("“{file_name}” could not be read as a Word document ({why})."),
        )
        .with("fileName", file_name),
    )
}

fn attr(e: &BytesStart, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .map(|a| unescape(a.value.as_ref()))
}

fn name_of(e: &BytesStart) -> String {
    e.name().as_ref().to_string()
}

/// A property like `<w:b/>` or `<w:b w:val="0"/>`.
fn toggle(e: &BytesStart) -> bool {
    !matches!(
        attr(e, "w:val")
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("0" | "false" | "off" | "none")
    )
}

fn skip_element(reader: &mut Reader<&[u8]>, name: &str) {
    let mut depth = 1usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if name_of(&e) == name => depth += 1,
            Ok(Event::End(e)) if e.name().as_ref() == name => {
                depth -= 1;
                if depth == 0 {
                    return;
                }
            }
            Ok(Event::Eof) | Err(_) => return,
            _ => {}
        }
    }
}

fn parse_rels(xml: &str) -> HashMap<String, Rel> {
    let mut out = HashMap::new();
    let mut reader = Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) if name_of(&e) == "Relationship" => {
                if let (Some(id), Some(target)) = (attr(&e, "Id"), attr(&e, "Target")) {
                    let external =
                        attr(&e, "TargetMode").is_some_and(|m| m.eq_ignore_ascii_case("external"));
                    let kind = attr(&e, "Type").unwrap_or_default();
                    let kind = kind.rsplit('/').next().unwrap_or("").to_string();
                    out.insert(id.clone(), Rel { target, external });
                    out.insert(
                        format!("type:{kind}"),
                        Rel {
                            target: id,
                            external,
                        },
                    );
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

fn parse_metadata(xml: &str) -> FoundMetadata {
    let mut meta = FoundMetadata::default();
    let mut reader = Reader::from_str(xml);
    let mut field: Option<&'static str> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                field = match name_of(&e).as_str() {
                    "dc:title" => Some("title"),
                    "dc:creator" => Some("author"),
                    "dc:language" => Some("language"),
                    _ => None,
                };
            }
            Ok(Event::Text(t)) => {
                let text = t.trim().to_string();
                if !text.is_empty() {
                    match field {
                        Some("title") => meta.title = Some(text),
                        Some("author") => meta.author = Some(text),
                        Some("language") => meta.language = Some(language_name(&text)),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(_)) => field = None,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    meta
}

fn parse_rpr(reader: &mut Reader<&[u8]>) -> RProps {
    let mut p = RProps::default();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) => match name_of(&e).as_str() {
                "w:b" => p.bold = Some(toggle(&e)),
                "w:i" => p.italic = Some(toggle(&e)),
                "w:u" => p.underline = Some(toggle(&e)),
                "w:strike" | "w:dstrike" => p.strike = Some(toggle(&e)),
                "w:caps" => p.caps = Some(toggle(&e)),
                "w:smallCaps" => p.small_caps = Some(toggle(&e)),
                "w:highlight" => p.highlight = Some(toggle(&e)),
                "w:vanish" => p.hidden = Some(toggle(&e)),
                "w:vertAlign" => {
                    p.vert = Some(match attr(&e, "w:val").as_deref() {
                        Some("superscript") => 1,
                        Some("subscript") => -1,
                        _ => 0,
                    })
                }
                "w:sz" => p.size = attr(&e, "w:val").and_then(|v| v.parse().ok()),
                "w:color" => {
                    p.color = Some(match attr(&e, "w:val") {
                        Some(v) if is_hex(&v) => v.to_ascii_lowercase(),
                        _ => String::new(),
                    })
                }
                "w:rFonts" => {
                    let font = attr(&e, "w:ascii")
                        .or_else(|| attr(&e, "w:hAnsi"))
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    if !font.is_empty() {
                        p.mono = Some(
                            ["courier", "consolas", "mono", "menlo", "lucida console"]
                                .iter()
                                .any(|m| font.contains(m)),
                        );
                    }
                }
                "w:rStyle" => p.style = attr(&e, "w:val"),
                _ => {}
            },
            Ok(Event::End(e)) if e.name().as_ref() == "w:rPr" => break,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    p
}

fn is_hex(v: &str) -> bool {
    v.len() == 6 && v.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_ppr(reader: &mut Reader<&[u8]>) -> PProps {
    let mut p = PProps::default();
    let (mut in_num, mut in_bdr, mut in_sect) = (false, false, false);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:numPr" => in_num = true,
                "w:pBdr" => in_bdr = true,
                "w:sectPr" => {
                    in_sect = true;
                    p.section = Some("nextPage".into());
                }
                "w:rPr" | "w:pPrChange" | "w:framePr" | "w:tabs" => {
                    skip_element(reader, &name_of(&e));
                }
                _ => apply_ppr(&mut p, &e, in_num, in_bdr, in_sect),
            },
            Ok(Event::Empty(e)) => apply_ppr(&mut p, &e, in_num, in_bdr, in_sect),
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:numPr" => in_num = false,
                "w:pBdr" => in_bdr = false,
                "w:sectPr" => in_sect = false,
                "w:pPr" => break,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    p
}

fn apply_ppr(p: &mut PProps, e: &BytesStart, in_num: bool, in_bdr: bool, in_sect: bool) {
    let int = |key: &str| attr(e, key).and_then(|v| v.parse::<i32>().ok());
    match name_of(e).as_str() {
        "w:pStyle" => p.style = attr(e, "w:val"),
        "w:jc" => p.jc = attr(e, "w:val"),
        "w:ind" => {
            p.ind_left = int("w:left").or_else(|| int("w:start")).or(p.ind_left);
            p.ind_right = int("w:right").or_else(|| int("w:end")).or(p.ind_right);
            if let Some(h) = int("w:hanging") {
                p.first = Some(-h.abs());
            } else if let Some(f) = int("w:firstLine") {
                p.first = Some(f);
            }
        }
        "w:spacing" => {
            p.before = int("w:before").or(p.before);
            p.after = int("w:after").or(p.after);
            let rule = attr(e, "w:lineRule");
            if matches!(rule.as_deref(), None | Some("auto")) {
                p.line = int("w:line").or(p.line);
            }
        }
        "w:bidi" => p.bidi = Some(toggle(e)),
        "w:outlineLvl" => {
            p.outline = attr(e, "w:val")
                .and_then(|v| v.parse::<u8>().ok())
                .filter(|l| *l < 9)
        }
        "w:pageBreakBefore" => p.page_break_before = toggle(e),
        "w:ilvl" if in_num => p.ilvl = attr(e, "w:val").and_then(|v| v.parse().ok()),
        "w:numId" if in_num => p.num_id = attr(e, "w:val").and_then(|v| v.parse().ok()),
        "w:bottom" if in_bdr => {
            p.bottom_rule = !matches!(attr(e, "w:val").as_deref(), Some("nil" | "none"));
        }
        "w:type" if in_sect => p.section = attr(e, "w:val").or(Some("nextPage".into())),
        _ => {}
    }
}

fn parse_styles(xml: &str) -> (HashMap<String, StyleDef>, RProps) {
    let mut styles = HashMap::new();
    let mut defaults = RProps::default();
    let mut reader = Reader::from_str(xml);
    let mut current: Option<(String, StyleDef)> = None;
    let mut in_defaults = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:docDefaults" => in_defaults = true,
                "w:style" => {
                    let id = attr(&e, "w:styleId").unwrap_or_default();
                    current = Some((
                        id,
                        StyleDef {
                            default: attr(&e, "w:default").is_some_and(|d| d == "1" || d == "true"),
                            character: attr(&e, "w:type").is_some_and(|t| t == "character"),
                            ..Default::default()
                        },
                    ));
                }
                "w:pPr" => {
                    let p = parse_ppr(&mut reader);
                    if let Some((_, s)) = current.as_mut() {
                        s.ppr = p;
                    }
                }
                "w:rPr" => {
                    let r = parse_rpr(&mut reader);
                    match current.as_mut() {
                        Some((_, s)) => s.rpr = r,
                        None if in_defaults => defaults = r,
                        None => {}
                    }
                }
                "w:tblPr" | "w:trPr" | "w:tcPr" | "w:tblStylePr" => {
                    skip_element(&mut reader, &name_of(&e));
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => {
                if let Some((_, s)) = current.as_mut() {
                    match name_of(&e).as_str() {
                        "w:name" => s.name = attr(&e, "w:val").unwrap_or_default(),
                        "w:basedOn" => s.based_on = attr(&e, "w:val"),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:docDefaults" => in_defaults = false,
                "w:style" => {
                    if let Some((id, s)) = current.take() {
                        styles.insert(id, s);
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    (styles, defaults)
}

#[derive(Debug, Clone, Default)]
struct Level {
    start: i64,
    format: String,
}

#[derive(Debug, Default)]
struct Numbering {
    abstracts: HashMap<i64, HashMap<usize, Level>>,
    /// numId → (abstract id, per-level start overrides).
    nums: HashMap<i64, (i64, HashMap<usize, i64>)>,
}

fn parse_numbering(xml: &str) -> Numbering {
    let mut out = Numbering::default();
    let mut reader = Reader::from_str(xml);
    let mut abstract_id: Option<i64> = None;
    let mut num_id: Option<i64> = None;
    let mut level: Option<usize> = None;
    let mut override_level: Option<usize> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:abstractNum" => {
                    abstract_id = attr(&e, "w:abstractNumId").and_then(|v| v.parse().ok());
                    if let Some(id) = abstract_id {
                        out.abstracts.entry(id).or_default();
                    }
                }
                "w:num" => {
                    num_id = attr(&e, "w:numId").and_then(|v| v.parse().ok());
                    if let Some(id) = num_id {
                        out.nums.entry(id).or_default();
                    }
                }
                "w:lvl" => {
                    level = attr(&e, "w:ilvl").and_then(|v| v.parse().ok());
                    if let (Some(a), Some(l)) = (abstract_id, level) {
                        out.abstracts
                            .entry(a)
                            .or_default()
                            .entry(l)
                            .or_insert(Level {
                                start: 1,
                                format: "decimal".into(),
                            });
                    }
                }
                "w:lvlOverride" => {
                    override_level = attr(&e, "w:ilvl").and_then(|v| v.parse().ok());
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => match name_of(&e).as_str() {
                "w:start" => {
                    let v = attr(&e, "w:val").and_then(|v| v.parse::<i64>().ok());
                    if let (Some(v), Some(l)) = (v, level) {
                        if let Some(n) = num_id.filter(|_| override_level.is_some()) {
                            if let Some(entry) = out.nums.get_mut(&n) {
                                entry.1.insert(l, v);
                            }
                        } else if let Some(a) = abstract_id {
                            if let Some(def) = out.abstracts.entry(a).or_default().get_mut(&l) {
                                def.start = v;
                            }
                        }
                    }
                }
                "w:numFmt" => {
                    if let (Some(a), Some(l), Some(f)) = (abstract_id, level, attr(&e, "w:val")) {
                        if num_id.is_none() {
                            if let Some(def) = out.abstracts.entry(a).or_default().get_mut(&l) {
                                def.format = f;
                            }
                        }
                    }
                }
                "w:abstractNumId" => {
                    if let (Some(n), Some(a)) = (
                        num_id,
                        attr(&e, "w:val").and_then(|v| v.parse::<i64>().ok()),
                    ) {
                        out.nums.entry(n).or_default().0 = a;
                    }
                }
                "w:startOverride" => {
                    if let (Some(n), Some(l), Some(v)) = (
                        num_id,
                        override_level,
                        attr(&e, "w:val").and_then(|v| v.parse::<i64>().ok()),
                    ) {
                        out.nums.entry(n).or_default().1.insert(l, v);
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:abstractNum" => {
                    abstract_id = None;
                    level = None;
                }
                "w:num" => {
                    num_id = None;
                    override_level = None;
                    level = None;
                }
                "w:lvl" => level = None,
                "w:lvlOverride" => override_level = None,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

// --- the story -----------------------------------------------------------------

struct Ctx<'a> {
    styles: &'a HashMap<String, (PProps, RProps)>,
    names: &'a HashMap<String, String>,
    rels: &'a HashMap<String, Rel>,
    char_styles: &'a HashMap<String, RProps>,
    paragraphs: usize,
}

/// A field being read (`HYPERLINK \l "name"` makes an internal link).
#[derive(Default)]
struct Field {
    instr: String,
    result: bool,
    link: bool,
}

fn parse_blocks(
    reader: &mut Reader<&[u8]>,
    ctx: &mut Ctx,
    until: &str,
    depth: usize,
    out: &mut Vec<Block>,
) {
    loop {
        if ctx.paragraphs > MAX_PARAGRAPHS {
            return;
        }
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:p" => {
                    let para = parse_para(reader, ctx);
                    ctx.paragraphs += 1;
                    out.push(Block::Para(para));
                }
                "w:tbl" if depth < MAX_TABLE_DEPTH => {
                    out.push(Block::Table(parse_table(reader, ctx, depth + 1)));
                }
                "w:tbl" => skip_element(reader, "w:tbl"),
                // Structure we read through; everything else here is dropped.
                "w:sdt"
                | "w:sdtContent"
                | "w:customXml"
                | "w:ins"
                | "w:moveTo"
                | "mc:AlternateContent"
                | "mc:Choice" => {}
                other => skip_element(reader, other),
            },
            Ok(Event::End(e)) if e.name().as_ref() == until => return,
            Ok(Event::Eof) | Err(_) => return,
            _ => {}
        }
    }
}

fn parse_table(reader: &mut Reader<&[u8]>, ctx: &mut Ctx, depth: usize) -> Table {
    let mut rows: Vec<Row> = Vec::new();
    let mut row: Option<Row> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:tr" => {
                    row = Some(Row {
                        header: false,
                        cells: Vec::new(),
                    })
                }
                "w:trPr" => {
                    // Only the "repeat as header row" flag matters.
                    let mut header = false;
                    loop {
                        match reader.read_event() {
                            Ok(Event::Start(e) | Event::Empty(e))
                                if name_of(&e) == "w:tblHeader" =>
                            {
                                header = toggle(&e)
                            }
                            Ok(Event::End(e)) if e.name().as_ref() == "w:trPr" => break,
                            Ok(Event::Eof) | Err(_) => break,
                            _ => {}
                        }
                    }
                    if let Some(r) = row.as_mut() {
                        r.header = header;
                    }
                }
                "w:tc" => {
                    let cell = parse_cell(reader, ctx, depth);
                    if let Some(r) = row.as_mut() {
                        r.cells.push(cell);
                    }
                }
                "w:tblPr" | "w:tblGrid" => skip_element(reader, &name_of(&e)),
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:tr" => {
                    if let Some(r) = row.take() {
                        rows.push(r);
                    }
                }
                "w:tbl" => break,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    let mut table = Table { rows };
    finish_table(&mut table);
    table
}

fn parse_cell(reader: &mut Reader<&[u8]>, ctx: &mut Ctx, depth: usize) -> Cell {
    let mut cell = Cell {
        span: 1,
        row_span: 1,
        skip: false,
        header: false,
        shade: None,
        blocks: Vec::new(),
        vmerge: VMerge::None,
    };
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if name_of(&e) == "w:tcPr" => loop {
                match reader.read_event() {
                    Ok(Event::Start(e) | Event::Empty(e)) => match name_of(&e).as_str() {
                        "w:gridSpan" => {
                            cell.span = attr(&e, "w:val")
                                .and_then(|v| v.parse::<u32>().ok())
                                .map_or(1, |v| v.clamp(1, 64))
                        }
                        "w:vMerge" => {
                            cell.vmerge = if attr(&e, "w:val").as_deref() == Some("restart") {
                                VMerge::Restart
                            } else {
                                VMerge::Continue
                            }
                        }
                        "w:shd" => {
                            cell.shade = attr(&e, "w:fill")
                                .filter(|f| is_hex(f) && light(f))
                                .map(|f| f.to_ascii_lowercase())
                        }
                        _ => {}
                    },
                    Ok(Event::End(e)) if e.name().as_ref() == "w:tcPr" => break,
                    Ok(Event::Eof) | Err(_) => break,
                    _ => {}
                }
            },
            Ok(Event::Start(e)) if name_of(&e) == "w:p" => {
                let para = parse_para(reader, ctx);
                ctx.paragraphs += 1;
                cell.blocks.push(Block::Para(para));
            }
            Ok(Event::Start(e)) if name_of(&e) == "w:tbl" && depth < MAX_TABLE_DEPTH => {
                cell.blocks
                    .push(Block::Table(parse_table(reader, ctx, depth + 1)));
            }
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:sdt"
                | "w:sdtContent"
                | "w:customXml"
                | "w:ins"
                | "mc:AlternateContent"
                | "mc:Choice" => {}
                other => skip_element(reader, other),
            },
            Ok(Event::End(e)) if e.name().as_ref() == "w:tc" => break,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    cell
}

/// Resolves vertical merges into row spans and decides which rows are headers.
fn finish_table(table: &mut Table) {
    // Grid column where each cell starts.
    let starts: Vec<Vec<usize>> = table
        .rows
        .iter()
        .map(|r| {
            let mut at = 0usize;
            r.cells
                .iter()
                .map(|c| {
                    let s = at;
                    at += c.span as usize;
                    s
                })
                .collect()
        })
        .collect();
    for r in 0..table.rows.len() {
        for c in 0..table.rows[r].cells.len() {
            match table.rows[r].cells[c].vmerge {
                VMerge::Continue => {
                    // A continued cell is part of the cell above it (when there is one).
                    let col = starts[r][c];
                    let has_above = (0..r).rev().any(|up| {
                        starts[up].iter().position(|s| *s == col).is_some_and(|i| {
                            matches!(
                                table.rows[up].cells[i].vmerge,
                                VMerge::Restart | VMerge::Continue
                            )
                        })
                    });
                    table.rows[r].cells[c].skip = has_above;
                }
                VMerge::Restart => {
                    let col = starts[r][c];
                    let mut span = 1u32;
                    for (below, at) in starts.iter().enumerate().skip(r + 1) {
                        let continued = at
                            .iter()
                            .position(|s| *s == col)
                            .is_some_and(|i| table.rows[below].cells[i].vmerge == VMerge::Continue);
                        if !continued {
                            break;
                        }
                        span += 1;
                    }
                    table.rows[r].cells[c].row_span = span.min(200);
                }
                VMerge::None => {}
            }
        }
    }
    // A first row that is all bold text reads as a header row even when the
    // document does not mark it as one.
    if table.rows.len() > 1 && !table.rows.iter().any(|r| r.header) {
        let first = &table.rows[0];
        let words = |c: &Cell| {
            let mut any = false;
            for b in &c.blocks {
                if let Block::Para(p) = b {
                    for i in &p.inlines {
                        if let Inline::Text(t, f) = i {
                            if t.trim().is_empty() {
                                continue;
                            }
                            any = true;
                            if !f.bold {
                                return None;
                            }
                        }
                    }
                }
            }
            any.then_some(())
        };
        if !first.cells.is_empty() && first.cells.iter().all(|c| words(c).is_some()) {
            table.rows[0].header = true;
        }
    }
    for row in &mut table.rows {
        let header = row.header;
        for cell in &mut row.cells {
            cell.header = header;
        }
    }
}

/// A fill light enough that dark text stays readable on it.
fn light(hex: &str) -> bool {
    luminance(hex) > 0.78
}

fn luminance(hex: &str) -> f64 {
    let v = |i: usize| f64::from(u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)) / 255.0;
    0.2126 * v(0) + 0.7152 * v(2) + 0.0722 * v(4)
}

fn parse_para(reader: &mut Reader<&[u8]>, ctx: &Ctx) -> Para {
    let mut direct = PProps::default();
    let mut inlines: Vec<Inline> = Vec::new();
    let mut fields: Vec<Field> = Vec::new();
    let mut open_links = 0usize;
    let mut break_before = false;
    let mut break_after = false;
    let mut text_seen = false;
    // Character formatting that applies to the whole paragraph (its style's).
    let mut style_rpr: Option<RProps> = None;
    let mut ppr_done = false;

    let finish_ppr = |ctx: &Ctx, direct: &PProps| -> RProps {
        let mut base = ctx
            .styles
            .get(direct.style.as_deref().unwrap_or(""))
            .map(|(_, r)| r.clone())
            .unwrap_or_default();
        // Headings are drawn as headings: their style's own size and weight stay out.
        let heading = resolve_heading(ctx, direct);
        if heading.is_some() {
            base.bold = None;
            base.size = None;
            base.color = None;
        } else if matches!(
            kind_of(ctx, direct.style.as_deref().unwrap_or("")),
            Kind::Title | Kind::Caption
        ) {
            // A title and a caption are sized by the reader's own style for them.
            base.size = None;
        }
        base
    };

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:pPr" => {
                    direct = parse_ppr(reader);
                    ppr_done = true;
                    style_rpr = Some(finish_ppr(ctx, &direct));
                }
                "w:r" => {
                    if !ppr_done {
                        ppr_done = true;
                        style_rpr = Some(finish_ppr(ctx, &direct));
                    }
                    parse_run(
                        reader,
                        ctx,
                        style_rpr.as_ref().expect("set above"),
                        &mut inlines,
                        &mut fields,
                        &mut open_links,
                        &mut break_before,
                        &mut break_after,
                        &mut text_seen,
                    );
                }
                "w:hyperlink" => {
                    let anchor = attr(&e, "w:anchor").or_else(|| {
                        attr(&e, "r:id").and_then(|id| {
                            ctx.rels
                                .get(&id)
                                .filter(|r| !r.external)
                                .and_then(|r| r.target.strip_prefix('#').map(str::to_string))
                        })
                    });
                    let web = || {
                        attr(&e, "r:id").and_then(|id| {
                            ctx.rels.get(&id).and_then(|r| safe_external_url(&r.target))
                        })
                    };
                    match anchor {
                        Some(a) => inlines.push(Inline::LinkStart(a)),
                        // A link to the web (http or https only); anything else keeps its text and is not a link.
                        None => match web() {
                            Some(url) => inlines.push(Inline::WebStart(url)),
                            None => inlines.push(Inline::LinkStart(String::new())),
                        },
                    }
                }
                "w:fldSimple" => {
                    let instr = attr(&e, "w:instr").unwrap_or_default();
                    match (hyperlink_anchor(&instr), hyperlink_web(&instr)) {
                        (Some(anchor), _) => inlines.push(Inline::LinkStart(anchor)),
                        (None, Some(url)) => inlines.push(Inline::WebStart(url)),
                        (None, None) => inlines.push(Inline::LinkStart(String::new())),
                    }
                }
                "w:bookmarkStart" => {
                    if let Some(name) = attr(&e, "w:name").filter(|n| !n.starts_with("_GoBack")) {
                        inlines.push(Inline::Bookmark(name));
                    }
                }
                "w:ins"
                | "w:smartTag"
                | "w:customXml"
                | "w:sdt"
                | "w:sdtContent"
                | "mc:AlternateContent"
                | "mc:Choice" => {}
                other => skip_element(reader, other),
            },
            Ok(Event::Empty(e)) => {
                if name_of(&e) == "w:bookmarkStart" {
                    if let Some(name) = attr(&e, "w:name").filter(|n| !n.starts_with("_GoBack")) {
                        inlines.push(Inline::Bookmark(name));
                    }
                }
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:hyperlink" | "w:fldSimple" => inlines.push(Inline::LinkEnd),
                "w:p" => break,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    // Links the document left open are closed here.
    while open_links > 0 {
        inlines.push(Inline::LinkEnd);
        open_links -= 1;
    }
    build_para(ctx, direct, inlines, break_before, break_after)
}

/// `HYPERLINK \l "name"`: an internal link; anything else is not one.
/// `HYPERLINK "https://…"`: a link to the web, if the address passes the one
/// rule for external links; anything else is not one.
fn hyperlink_web(instr: &str) -> Option<String> {
    let t = instr.trim();
    if !t.to_ascii_uppercase().starts_with("HYPERLINK") {
        return None;
    }
    let rest = t[9..].trim_start();
    let candidate = match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => rest.split_whitespace().next()?,
    };
    safe_external_url(candidate)
}

fn hyperlink_anchor(instr: &str) -> Option<String> {
    let t = instr.trim();
    if !t.to_ascii_uppercase().starts_with("HYPERLINK") {
        return None;
    }
    let at = t.find("\\l")?;
    let rest = t[at + 2..].trim_start();
    let rest = rest.strip_prefix('"')?;
    let name = rest.split('"').next()?;
    (!name.is_empty()).then(|| name.to_string())
}

#[allow(clippy::too_many_arguments)]
fn parse_run(
    reader: &mut Reader<&[u8]>,
    ctx: &Ctx,
    style_rpr: &RProps,
    inlines: &mut Vec<Inline>,
    fields: &mut Vec<Field>,
    open_links: &mut usize,
    break_before: &mut bool,
    break_after: &mut bool,
    text_seen: &mut bool,
) {
    let mut rpr = RProps::default();
    let mut in_text = false;
    let mut in_instr = false;
    // Content is held until the run's properties are known (they come first).
    let mut pending: Vec<Inline> = Vec::new();
    let mut text = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match name_of(&e).as_str() {
                "w:rPr" => rpr = parse_rpr(reader),
                "w:t" => in_text = true,
                "w:instrText" => in_instr = true,
                "w:drawing" => {
                    if let Some(img) = parse_drawing(reader) {
                        pending.push(Inline::Image(img));
                    }
                }
                "w:pict" => {
                    if let Some(img) = parse_pict(reader) {
                        pending.push(Inline::Image(img));
                    }
                }
                "mc:AlternateContent" | "mc:Choice" => {}
                other => skip_element(reader, other),
            },
            Ok(Event::Empty(e)) => match name_of(&e).as_str() {
                "w:tab" => text.push('\t'),
                "w:noBreakHyphen" => text.push('\u{2011}'),
                "w:cr" => {
                    flush_text(&mut text, &mut pending);
                    pending.push(Inline::Br);
                }
                "w:br" => match attr(&e, "w:type").as_deref() {
                    Some("page") => {
                        if *text_seen || !text.is_empty() {
                            *break_after = true;
                        } else {
                            *break_before = true;
                        }
                    }
                    _ => {
                        flush_text(&mut text, &mut pending);
                        pending.push(Inline::Br);
                    }
                },
                "w:footnoteReference" | "w:endnoteReference" => {
                    if let Some(id) = attr(&e, "w:id").and_then(|v| v.parse::<i64>().ok()) {
                        flush_text(&mut text, &mut pending);
                        pending.push(Inline::NoteRef(name_of(&e) == "w:endnoteReference", id));
                    }
                }
                "w:fldChar" => match attr(&e, "w:fldCharType").as_deref() {
                    Some("begin") => fields.push(Field::default()),
                    Some("separate") => {
                        if let Some(f) = fields.last_mut() {
                            f.result = true;
                            if let Some(anchor) = hyperlink_anchor(&f.instr) {
                                f.link = true;
                                *open_links += 1;
                                pending.push(Inline::LinkStart(anchor));
                            } else if let Some(url) = hyperlink_web(&f.instr) {
                                f.link = true;
                                *open_links += 1;
                                pending.push(Inline::WebStart(url));
                            }
                        }
                    }
                    Some("end") => {
                        if let Some(f) = fields.pop() {
                            if f.link {
                                *open_links = open_links.saturating_sub(1);
                                flush_text(&mut text, &mut pending);
                                pending.push(Inline::LinkEnd);
                            }
                        }
                    }
                    _ => {}
                },
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if in_text {
                    text.push_str(&t);
                } else if in_instr {
                    if let Some(f) = fields.last_mut() {
                        if !f.result {
                            f.instr.push_str(&t);
                        }
                    }
                }
            }
            Ok(Event::GeneralRef(r)) if in_text => {
                text.push_str(&unescape(&format!("&{};", &*r)));
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:t" => in_text = false,
                "w:instrText" => in_instr = false,
                "w:r" => break,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    flush_text(&mut text, &mut pending);
    // The run's formatting: the paragraph style's, then a character style's, then its own.
    let mut effective = style_rpr.clone();
    if let Some(char_style) = rpr.style.as_ref().and_then(|s| ctx.char_styles.get(s)) {
        effective.over(char_style);
    }
    effective.over(&rpr);
    let fmt = effective.fmt();
    for item in pending {
        match item {
            Inline::Text(t, _) => {
                if fmt.hidden {
                    continue;
                }
                if !t.trim().is_empty() {
                    *text_seen = true;
                }
                // Neighbouring runs that look the same are one run.
                if let Some(Inline::Text(last, last_fmt)) = inlines.last_mut() {
                    if *last_fmt == fmt {
                        last.push_str(&t);
                        continue;
                    }
                }
                inlines.push(Inline::Text(t, fmt.clone()));
            }
            other => inlines.push(other),
        }
    }
}

fn flush_text(text: &mut String, pending: &mut Vec<Inline>) {
    if !text.is_empty() {
        pending.push(Inline::Text(std::mem::take(text), Fmt::default()));
    }
}

fn emu_to_px(v: &str) -> Option<u32> {
    v.parse::<u64>()
        .ok()
        .map(|e| (e / 9525).clamp(1, 20_000) as u32)
}

fn parse_drawing(reader: &mut Reader<&[u8]>) -> Option<ImageRef> {
    let mut rid: Option<String> = None;
    let (mut w, mut h) = (None, None);
    let mut alt = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) => match name_of(&e).as_str() {
                "wp:extent" => {
                    w = attr(&e, "cx").and_then(|v| emu_to_px(&v));
                    h = attr(&e, "cy").and_then(|v| emu_to_px(&v));
                }
                "wp:docPr" | "pic:cNvPr" => {
                    if alt.is_empty() {
                        alt = attr(&e, "descr").unwrap_or_default();
                    }
                }
                // A picture linked from outside the file is not loaded.
                "a:blip" => {
                    if rid.is_none() {
                        rid = attr(&e, "r:embed");
                    }
                }
                "mc:Fallback" => skip_element(reader, "mc:Fallback"),
                "w:txbxContent" => skip_element(reader, "w:txbxContent"),
                _ => {}
            },
            Ok(Event::End(e)) if e.name().as_ref() == "w:drawing" => break,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    rid.map(|rid| ImageRef {
        rid,
        width: w,
        height: h,
        alt,
    })
}

fn parse_pict(reader: &mut Reader<&[u8]>) -> Option<ImageRef> {
    let mut rid: Option<String> = None;
    let mut alt = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) => match name_of(&e).as_str() {
                "v:imagedata" => {
                    if rid.is_none() {
                        rid = attr(&e, "r:id");
                        alt = attr(&e, "o:title").unwrap_or_default();
                    }
                }
                "w:txbxContent" => skip_element(reader, "w:txbxContent"),
                _ => {}
            },
            Ok(Event::End(e)) if e.name().as_ref() == "w:pict" => break,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    rid.map(|rid| ImageRef {
        rid,
        width: None,
        height: None,
        alt,
    })
}

/// The heading level a paragraph has (1–6): by its style's name, or by an outline level.
fn resolve_heading(ctx: &Ctx, direct: &PProps) -> Option<u8> {
    let style = direct.style.as_deref().unwrap_or("");
    let resolved = ctx.styles.get(style).map(|(p, _)| p);
    let outline = direct.outline.or_else(|| resolved.and_then(|p| p.outline));
    let name = ctx
        .names
        .get(style)
        .map(|n| n.to_ascii_lowercase())
        .unwrap_or_default();
    let by_name = name
        .strip_prefix("heading ")
        .and_then(|n| n.trim().parse::<u8>().ok())
        .filter(|n| (1..=9).contains(n))
        .map(|n| n - 1);
    outline.or(by_name).map(|l| l.min(5) + 1)
}

fn kind_of(ctx: &Ctx, style: &str) -> Kind {
    let name = ctx
        .names
        .get(style)
        .map(|n| n.to_ascii_lowercase())
        .unwrap_or_else(|| style.to_ascii_lowercase());
    match name.as_str() {
        "title" => Kind::Title,
        "quote" | "intense quote" | "block text" | "block quotation" => Kind::Quote,
        "code" | "html preformatted" | "plain text" | "source code" | "preformatted text"
        | "macro text" => Kind::Code,
        "caption" => Kind::Caption,
        _ => Kind::Normal,
    }
}

fn build_para(
    ctx: &Ctx,
    direct: PProps,
    inlines: Vec<Inline>,
    break_before: bool,
    break_after: bool,
) -> Para {
    let style_id = direct.style.clone().unwrap_or_default();
    let mut props = ctx
        .styles
        .get(&style_id)
        .map(|(p, _)| p.clone())
        .unwrap_or_default();
    props.over(&direct);
    let heading = resolve_heading(ctx, &direct);
    let kind = kind_of(ctx, &style_id);
    let mut text = String::new();
    for i in &inlines {
        match i {
            Inline::Text(t, _) => text.push_str(t),
            Inline::Br => text.push(' '),
            _ => {}
        }
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");

    // The paragraph's own look: alignment, indentation, spacing, kept inside the page.
    let mut css = Vec::new();
    let rtl = props.bidi.unwrap_or(false);
    match props.jc.as_deref() {
        Some("center") => css.push("text-align:center".to_string()),
        Some("both" | "distribute") => css.push("text-align:justify".to_string()),
        Some("right" | "end") if !rtl => css.push("text-align:end".to_string()),
        Some("left" | "start") if rtl => css.push("text-align:start".to_string()),
        _ => {}
    }
    let list = props.num_id.filter(|n| *n != 0).and_then(|n| {
        heading
            .is_none()
            .then_some((n, props.ilvl.unwrap_or(0).min(8)))
    });
    if heading.is_none() && list.is_none() {
        let px = |twips: i32, lo: i32, hi: i32| (twips / 15).clamp(lo, hi);
        if let Some(l) = direct.ind_left.or(props.ind_left).filter(|l| *l > 0) {
            css.push(format!("margin-inline-start:{}px", px(l, 0, 360)));
        }
        if let Some(r) = direct.ind_right.or(props.ind_right).filter(|r| *r > 0) {
            css.push(format!("margin-inline-end:{}px", px(r, 0, 240)));
        }
        if let Some(f) = props.first.filter(|f| *f != 0) {
            css.push(format!("text-indent:{}px", px(f, -200, 200)));
        }
    }
    if let Some(b) = direct.before.filter(|v| *v >= 0) {
        css.push(format!("margin-top:{}px", (b / 15).clamp(0, 48)));
    }
    if let Some(a) = direct.after.filter(|v| *v >= 0) {
        css.push(format!("margin-bottom:{}px", (a / 15).clamp(0, 48)));
    }
    if heading.is_none() {
        if let Some(line) = props.line.filter(|l| *l >= 360) {
            css.push(format!(
                "line-height:{:.2}",
                (f64::from(line) / 240.0).clamp(1.0, 3.0)
            ));
        }
    }
    let rule = direct.bottom_rule
        && text.is_empty()
        && !inlines.iter().any(|i| matches!(i, Inline::Image(_)));
    let section_break = props.section.as_deref().is_some_and(|t| t != "continuous");
    Para {
        heading,
        kind,
        css: css.join(";"),
        rtl,
        list: None,
        inlines,
        text,
        break_before: break_before || direct.page_break_before,
        break_after: break_after || (direct.section.is_some() && section_break),
        rule,
        segment: 0,
        id: None,
        num: list,
    }
}

// --- the whole document ----------------------------------------------------------

fn part_path(rels: &HashMap<String, Rel>, kind: &str, dir: &str, default: &str) -> String {
    rels.get(&format!("type:{kind}"))
        .and_then(|r| rels.get(&r.target))
        .filter(|r| !r.external)
        .and_then(|r| resolve_target(dir, &r.target))
        .unwrap_or_else(|| default.to_string())
}

/// A relationship target as an archive path: relative to the part's folder, or
/// absolute within the package. Anything leaving the package gives None.
pub(super) fn resolve_target(dir: &str, target: &str) -> Option<String> {
    if target.contains(':') || target.contains('\\') || target.contains('\0') {
        return None;
    }
    let (base, rel) = match target.strip_prefix('/') {
        Some(abs) => ("", abs),
        None => (dir, target),
    };
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn rels_path(part: &str) -> String {
    match part.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
        None => format!("_rels/{part}.rels"),
    }
}

pub(super) fn read_docx(bytes: &[u8], file_name: &str) -> AppResult<Docx> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| bad(file_name, "not a valid archive"))?;
    let package_rels = read_entry(&mut archive, "_rels/.rels")
        .map(|x| parse_rels(&x))
        .unwrap_or_default();
    let document_path = package_rels
        .get("type:officeDocument")
        .and_then(|r| package_rels.get(&r.target))
        .filter(|r| !r.external)
        .and_then(|r| resolve_target("", &r.target))
        .unwrap_or_else(|| "word/document.xml".to_string());
    let document_xml =
        read_entry(&mut archive, &document_path).ok_or_else(|| bad(file_name, "no document"))?;
    let dir = document_path
        .rsplit_once('/')
        .map(|(d, _)| format!("{d}/"))
        .unwrap_or_default();
    // A missing or damaged relationships part only costs the links and pictures.
    let rels = read_entry(&mut archive, &rels_path(&document_path))
        .map(|x| parse_rels(&x))
        .unwrap_or_default();

    let styles_path = part_path(&rels, "styles", &dir, "word/styles.xml");
    let (style_defs, defaults) = read_entry(&mut archive, &styles_path)
        .map(|x| parse_styles(&x))
        .unwrap_or_default();
    let numbering = read_entry(
        &mut archive,
        &part_path(&rels, "numbering", &dir, "word/numbering.xml"),
    )
    .map(|x| parse_numbering(&x))
    .unwrap_or_default();

    // Styles resolved along their `basedOn` chains.
    let mut resolved: HashMap<String, (PProps, RProps)> = HashMap::new();
    let mut names: HashMap<String, String> = HashMap::new();
    for (id, def) in &style_defs {
        names.insert(id.clone(), def.name.clone());
        let mut chain = vec![def];
        let mut seen: HashSet<&str> = HashSet::new();
        let mut next = def.based_on.as_deref();
        while let Some(parent) = next {
            if !seen.insert(parent) || chain.len() > 16 {
                break;
            }
            match style_defs.get(parent) {
                Some(p) => {
                    chain.push(p);
                    next = p.based_on.as_deref();
                }
                None => break,
            }
        }
        let (mut p, mut r) = (PProps::default(), defaults.clone());
        for s in chain.iter().rev() {
            p.over(&s.ppr);
            r.over(&s.rpr);
        }
        resolved.insert(id.clone(), (p, r));
    }
    let char_styles: HashMap<String, RProps> = style_defs
        .iter()
        .filter(|(_, d)| d.character)
        .map(|(id, _)| (id.clone(), resolved[id].1.clone()))
        .collect();
    let base_size = style_defs
        .iter()
        .find(|(_, d)| d.default && !d.character)
        .and_then(|(id, _)| resolved.get(id).and_then(|(_, r)| r.size))
        .or(defaults.size)
        .unwrap_or(22)
        .clamp(8, 200);

    let mut ctx = Ctx {
        styles: &resolved,
        names: &names,
        rels: &rels,
        char_styles: &char_styles,
        paragraphs: 0,
    };

    let mut blocks = Vec::new();
    {
        let mut reader = Reader::from_str(&document_xml);
        reader.config_mut().check_end_names = false;
        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) if name_of(&e) == "w:body" => {
                    parse_blocks(&mut reader, &mut ctx, "w:body", 0, &mut blocks);
                    break;
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }

    let read_notes = |archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
                      kind: &str,
                      default: &str,
                      tag: &str,
                      ctx: &mut Ctx| {
        let path = part_path(&rels, kind, &dir, default);
        let mut notes: HashMap<i64, Vec<Block>> = HashMap::new();
        if let Some(xml) = read_entry(archive, &path) {
            let mut reader = Reader::from_str(&xml);
            reader.config_mut().check_end_names = false;
            loop {
                match reader.read_event() {
                    Ok(Event::Start(e)) if name_of(&e) == tag => {
                        let id = attr(&e, "w:id").and_then(|v| v.parse::<i64>().ok());
                        let special = attr(&e, "w:type").is_some_and(|t| t != "normal");
                        let mut found = Vec::new();
                        parse_blocks(&mut reader, ctx, tag, 0, &mut found);
                        if let (Some(id), false) = (id, special) {
                            notes.insert(id, found);
                        }
                    }
                    Ok(Event::Eof) | Err(_) => break,
                    _ => {}
                }
            }
        }
        notes
    };
    let mut foot = read_notes(
        &mut archive,
        "footnotes",
        "word/footnotes.xml",
        "w:footnote",
        &mut ctx,
    );
    let mut end = read_notes(
        &mut archive,
        "endnotes",
        "word/endnotes.xml",
        "w:endnote",
        &mut ctx,
    );

    let metadata = read_entry(&mut archive, "docProps/core.xml")
        .map(|x| parse_metadata(&x))
        .unwrap_or_default();

    // Notes, in the order the text refers to them, numbered as Word does.
    let mut notes: Vec<Note> = Vec::new();
    let mut labels: (usize, usize) = (0, 0);
    let mut collect = |blocks: &[Block],
                       notes: &mut Vec<Note>,
                       foot: &mut HashMap<i64, Vec<Block>>,
                       end: &mut HashMap<i64, Vec<Block>>| {
        fn walk(b: &[Block], f: &mut dyn FnMut(&Para)) {
            for block in b {
                match block {
                    Block::Para(p) => f(p),
                    Block::Table(t) => {
                        for r in &t.rows {
                            for c in &r.cells {
                                walk(&c.blocks, f);
                            }
                        }
                    }
                }
            }
        }
        walk(blocks, &mut |p| {
            for i in &p.inlines {
                if let Inline::NoteRef(endnote, id) = i {
                    let source = if *endnote { &mut *end } else { &mut *foot };
                    if let Some(found) = source.remove(id) {
                        let label = if *endnote {
                            labels.1 += 1;
                            labels.1
                        } else {
                            labels.0 += 1;
                            labels.0
                        };
                        notes.push(Note {
                            endnote: *endnote,
                            id: *id,
                            label,
                            blocks: found,
                        });
                    }
                }
            }
        });
    };
    collect(&blocks, &mut notes, &mut foot, &mut end);
    // Footnotes first, then endnotes, each in the order of reference.
    notes.sort_by_key(|n| (n.endnote, n.label));

    let mut doc = Docx {
        metadata,
        blocks,
        notes,
        rels,
        dir,
        base_size,
        segments: Vec::new(),
        headings: Vec::new(),
        chapters: 0,
        marks: Vec::new(),
        parts: Vec::new(),
        notes_part: None,
        bookmarks: HashMap::new(),
        note_refs: HashMap::new(),
    };
    lay_out(&mut doc, &numbering);
    Ok(doc)
}

// --- layout: segments, ids, lists, parts --------------------------------------------

/// A note reference: which note, the element id of its marker, the segment and the top-level block.
type NoteRefMark = ((bool, i64), String, usize, Option<usize>);

struct Layout<'a> {
    segments: Vec<NewSegment>,
    headings: Vec<Heading>,
    names: Vec<Option<String>>,
    paragraph: u32,
    heading_count: usize,
    chapters: u32,
    /// (id, segment, top-level block, bookmark name when it is one)
    marks: Vec<(String, usize, Option<usize>, Option<String>)>,
    refs: Vec<NoteRefMark>,
    numbering: &'a Numbering,
    counters: HashMap<(i64, usize), i64>,
    started: HashSet<(i64, usize)>,
    ids: HashSet<String>,
    in_notes: bool,
}

fn bookmark_id(name: &str, used: &mut HashSet<String>) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .take(MAX_ID_CHARS)
        .collect();
    let mut id = format!("bm-{clean}");
    let mut n = 1;
    while !used.insert(id.clone()) {
        n += 1;
        id = format!("bm-{clean}-{n}");
    }
    id
}

impl Layout<'_> {
    fn block(&mut self, b: &mut Block, top: Option<usize>) {
        match b {
            Block::Para(p) => self.para(p, top),
            Block::Table(t) => {
                for row in &mut t.rows {
                    for cell in &mut row.cells {
                        for inner in &mut cell.blocks {
                            self.block(inner, top);
                        }
                    }
                }
            }
        }
    }

    fn para(&mut self, p: &mut Para, top: Option<usize>) {
        p.segment = self.segments.len();
        let at = p.segment;
        for i in &p.inlines {
            match i {
                Inline::Bookmark(name) => {
                    let id = bookmark_id(name, &mut self.ids);
                    self.marks.push((id, at, top, Some(name.clone())));
                }
                Inline::NoteRef(endnote, id) if !self.in_notes => {
                    let eid = format!("{}{id}", if *endnote { "er" } else { "fr" });
                    self.refs.push(((*endnote, *id), eid.clone(), at, top));
                    self.marks.push((eid, at, top, None));
                }
                _ => {}
            }
        }
        self.list_item(p);
        if let Some(level) = p.heading {
            if p.text.is_empty() {
                p.heading = None;
                return;
            }
            if !self.in_notes {
                let slot = usize::from(level) - 1;
                self.names[slot] = Some(p.text.clone());
                for deeper in self.names.iter_mut().skip(slot + 1) {
                    *deeper = None;
                }
                self.paragraph = 0;
                if level == 1 {
                    self.chapters += 1;
                }
                self.headings.push(Heading {
                    level,
                    title: p.text.clone(),
                    segment: at,
                });
            }
            let id = format!("h{}", self.heading_count);
            self.heading_count += 1;
            self.marks.push((id.clone(), at, top, None));
            p.id = Some(id);
            return;
        }
        if p.text.is_empty() {
            return;
        }
        let present: Vec<&str> = self.names.iter().flatten().map(String::as_str).collect();
        let section_path = (!present.is_empty() && !self.in_notes).then(|| present.join(" › "));
        let heading = if self.in_notes {
            None
        } else {
            self.names.iter().rev().flatten().next().cloned()
        };
        let chapter = if self.in_notes {
            None
        } else {
            self.names[0].clone()
        };
        let id = format!("p{at}");
        self.marks.push((id.clone(), at, top, None));
        p.id = Some(id);
        for part in split_long(&p.text, MAX_SEGMENT) {
            self.segments.push(NewSegment {
                text: part,
                chapter: chapter.clone(),
                heading: heading.clone(),
                section_path: section_path.clone().or_else(|| chapter.clone()),
                paragraph_index: Some(self.paragraph),
                ..Default::default()
            });
            self.paragraph += 1;
        }
    }

    /// Resolves a list paragraph's kind and number (numbering restarts and continues as in Word).
    fn list_item(&mut self, p: &mut Para) {
        let Some((num_id, level)) = p.num.take() else {
            return;
        };
        let Some((abstract_id, overrides)) = self.numbering.nums.get(&num_id) else {
            // A list the document does not define still reads as a bullet list.
            p.list = Some(ListItem {
                num_id,
                level,
                kind: ListKind::Bullet,
                number: 1,
            });
            return;
        };
        let def = self
            .numbering
            .abstracts
            .get(abstract_id)
            .and_then(|a| a.get(&level))
            .cloned()
            .unwrap_or(Level {
                start: 1,
                format: "decimal".into(),
            });
        let kind = match def.format.as_str() {
            "bullet" => ListKind::Bullet,
            "none" => ListKind::Plain,
            "lowerLetter" => ListKind::Ordered("a"),
            "upperLetter" => ListKind::Ordered("A"),
            "lowerRoman" => ListKind::Ordered("i"),
            "upperRoman" => ListKind::Ordered("I"),
            _ => ListKind::Ordered("1"),
        };
        // Counting runs per abstract list; a new list (a `startOverride`) begins again.
        let key = (*abstract_id, level);
        if let Some(start) = overrides.get(&level) {
            if self.started.insert((num_id, level)) {
                self.counters.insert(key, *start - 1);
            }
        }
        let counter = self.counters.entry(key).or_insert(def.start - 1);
        *counter += 1;
        let number = *counter;
        // Deeper levels begin again under a new item of this one.
        self.counters
            .retain(|(a, l), _| *a != *abstract_id || *l <= level);
        p.list = Some(ListItem {
            num_id,
            level,
            kind,
            number,
        });
    }
}

fn weight(b: &Block) -> usize {
    match b {
        Block::Para(p) => {
            1 + 8 * p
                .inlines
                .iter()
                .filter(|i| matches!(i, Inline::Image(_)))
                .count()
        }
        Block::Table(t) => 2 + t.rows.iter().map(|r| r.cells.len()).sum::<usize>(),
    }
}

fn lay_out(doc: &mut Docx, numbering: &Numbering) {
    let mut lay = Layout {
        segments: Vec::new(),
        headings: Vec::new(),
        names: vec![None; 6],
        paragraph: 0,
        heading_count: 0,
        chapters: 0,
        marks: Vec::new(),
        refs: Vec::new(),
        numbering,
        counters: HashMap::new(),
        started: HashSet::new(),
        ids: HashSet::new(),
        in_notes: false,
    };
    // Where each top-level block starts among the segments.
    let mut starts = Vec::with_capacity(doc.blocks.len());
    for (i, b) in doc.blocks.iter_mut().enumerate() {
        starts.push(lay.segments.len());
        lay.block(b, Some(i));
    }
    // Parts: runs of top-level blocks, broken before a top-level heading when
    // the part is already substantial, and whenever it grows large. Never
    // inside a list.
    let mut parts: Vec<PartPlan> = Vec::new();
    let mut begin = 0usize;
    let mut load = 0usize;
    for (i, b) in doc.blocks.iter().enumerate() {
        let is_item = |b: &Block| matches!(b, Block::Para(p) if p.list.is_some());
        let in_list = is_item(b) && i > 0 && is_item(&doc.blocks[i - 1]);
        let at_heading = matches!(b, Block::Para(p) if p.heading == Some(1));
        if i > begin
            && !in_list
            && (load >= PART_WEIGHT || (at_heading && load >= PART_WEIGHT_AT_HEADING))
        {
            parts.push(PartPlan {
                id: format!("d{}", parts.len()),
                start: begin,
                end: i,
                first_segment: starts[begin],
            });
            begin = i;
            load = 0;
        }
        load += weight(b);
    }
    if !doc.blocks.is_empty() {
        parts.push(PartPlan {
            id: format!("d{}", parts.len()),
            start: begin,
            end: doc.blocks.len(),
            first_segment: starts[begin],
        });
    }
    let part_of = |top: Option<usize>| -> Option<usize> {
        top.and_then(|t| parts.iter().position(|p| t >= p.start && t < p.end))
    };

    // The notes follow the body, as segments of their own.
    lay.in_notes = true;
    let notes_first = lay.segments.len();
    let mut notes = std::mem::take(&mut doc.notes);
    for n in &mut notes {
        let first = lay.segments.len();
        for b in &mut n.blocks {
            lay.block(b, None);
        }
        let id = format!("{}{}", if n.endnote { "en" } else { "fn" }, n.id);
        lay.marks.push((id, first, None, None));
    }
    doc.notes = notes;

    for (id, segment, top, name) in &lay.marks {
        let part = part_of(*top);
        doc.marks.push(Mark {
            id: id.clone(),
            segment: *segment,
            part,
        });
        if let Some(name) = name {
            doc.bookmarks
                .entry(name.clone())
                .or_insert((id.clone(), part));
        }
    }
    for (key, id, _, top) in &lay.refs {
        doc.note_refs
            .entry(*key)
            .or_insert((id.clone(), part_of(*top)));
    }
    doc.segments = lay.segments;
    doc.headings = lay.headings;
    doc.chapters = lay.chapters;
    doc.parts = parts;
    doc.notes_part = (!doc.notes.is_empty()).then_some(NotesPlan {
        first_segment: notes_first,
    });
}
