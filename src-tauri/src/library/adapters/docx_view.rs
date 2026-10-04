//! The formatted view of a DOCX: one part of the document at a time, turned
//! into the same small typed tree the formatted EPUB view uses, so the
//! interface draws both with one renderer.
//!
//! A Word document is untrusted input. Nothing here hands markup to the web
//! view and nothing in the file runs, loads or opens: the document is read
//! from the managed file, parsed into a model (`docx`), and the tree is built
//! from an allow-list of elements. Specifically:
//!
//! - **Content**: paragraphs, headings, lists, tables, figures, pictures,
//!   links to places in the document, footnotes and endnotes. Fields (other
//!   than links to a bookmark), macros, embedded objects, text boxes, SmartArt,
//!   charts, comments, tracked-change markup and hidden text are not drawn.
//! - **Links**: a link to a bookmark in the document becomes a target (part
//!   and element id); a link to the web, a file, or anything else is shown as
//!   its plain text. Nothing is ever opened by the page.
//! - **Pictures**: only files inside the package, found by the relationship
//!   that names them (an absolute or climbing path is refused), of a known
//!   image type, within a size limit, sent as `data:` URLs. Pictures linked
//!   from outside the file, missing, damaged or too large are replaced by
//!   their description, not silently dropped.
//! - **Styling**: only values this module writes itself: alignment,
//!   indentation, spacing, a relative font size, a readable text colour, a
//!   light cell fill. All are bounded. Nothing from the document's styles
//!   reaches the interface as text.
//!
//! Nothing is stored and nothing is written: it is all derived from the file.

use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read};

use super::docx::{
    read_docx, resolve_target, Block, Cell, Docx, Fmt, ImageRef, Inline, Kind, ListKind, Para,
    Table, NOTES_PART,
};
use super::epub_view::{
    base64, image_mime, El, EpubItem, LinkTarget, Node, MAX_IMAGES_TOTAL, MAX_IMAGE_BYTES,
};
use crate::error::{AppError, AppResult, UserMessage};

const MAX_NODES: usize = 400_000;
const MAX_IMAGE_WIDTH: u32 = 1_600;

/// The style of the formatted page that is the DOCX's own: how its few special
/// paragraphs look. Written here, never taken from the document.
const CSS: &str = r#"
.aw-doc p, .aw-doc li, .aw-doc td, .aw-doc th, .aw-doc h1, .aw-doc h2, .aw-doc h3, .aw-doc h4, .aw-doc h5, .aw-doc h6 { white-space: pre-wrap; tab-size: 4; }
.aw-doc .aw-title { font-size: 2em; text-align: center; margin-top: 0.6em; }
.aw-doc .aw-caption { font-size: 0.9em; color: #555; margin: -0.4em 0 1em; }
.aw-doc figure { text-align: center; }
.aw-doc figure img { max-width: 100%; height: auto; }
.aw-doc .aw-code, .aw-doc code { font-family: Consolas, Menlo, "Courier New", monospace; font-size: 0.92em; }
.aw-doc .aw-code { background: #f6f3ec; padding: 0.1em 0.5em; }
.aw-doc .aw-nobullet { list-style: none; padding-left: 0.5em; }
.aw-doc hr.aw-pagebreak { border-top: 1px dashed #bbb8ae; margin: 2em 0; }
.aw-doc li > p { margin: 0 0 0.4em; }
.aw-doc td > p:last-child, .aw-doc th > p:last-child { margin-bottom: 0; }
.aw-doc mark { background: #fff2a8; color: inherit; }
"#;

fn unavailable() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "library.originalUnavailable",
        "The original of this source can’t be opened.",
    ))
}

/// One part of the document (an id from the structure), sanitised.
pub fn render_part(bytes: &[u8], part_id: &str) -> AppResult<EpubItem> {
    let doc = read_docx(bytes, "document.docx").map_err(|_| unavailable())?;
    let archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| unavailable())?;
    let mut view = View {
        doc: &doc,
        archive,
        image_bytes: 0,
        missing: 0,
        nodes: 0,
        used_ids: HashSet::new(),
    };
    let mut out = Vec::new();
    if part_id == NOTES_PART {
        if doc.notes_part.is_none() {
            return Err(unavailable());
        }
        view.notes(&mut out);
    } else {
        let part = doc
            .parts
            .iter()
            .find(|p| p.id == part_id)
            .ok_or_else(unavailable)?;
        view.blocks(&doc.blocks[part.start..part.end], &mut out);
    }
    Ok(EpubItem {
        id: part_id.to_string(),
        nodes: out,
        css: CSS.to_string(),
        root: BTreeMap::new(),
        missing_images: view.missing,
    })
}

struct View<'a> {
    doc: &'a Docx,
    archive: zip::ZipArchive<Cursor<&'a [u8]>>,
    image_bytes: u64,
    missing: u32,
    nodes: usize,
    used_ids: HashSet<String>,
}

fn el(t: &'static str, attrs: Vec<(&'static str, String)>, c: Vec<Node>) -> El {
    El {
        t,
        a: attrs.into_iter().collect(),
        c,
        l: None,
    }
}

/// A list being built: its element, the level it is at, and the number the next item should have.
struct Frame {
    level: usize,
    num_id: i64,
    list: El,
    expect: i64,
}

fn attach(frame: Frame, parent: Option<&mut Frame>, out: &mut Vec<Node>) {
    let node = Node::El(frame.list);
    match parent {
        Some(p) => match p.list.c.last_mut() {
            Some(Node::El(li)) if li.t == "li" => li.c.push(node),
            _ => p.list.c.push(Node::El(el("li", vec![], vec![node]))),
        },
        None => out.push(node),
    }
}

fn close_to(lists: &mut Vec<Frame>, depth: usize, out: &mut Vec<Node>) {
    while lists.len() > depth {
        let Some(done) = lists.pop() else { return };
        attach(done, lists.last_mut(), out);
    }
}

fn roman(mut n: usize) -> String {
    let table = [
        (1000, "m"),
        (900, "cm"),
        (500, "d"),
        (400, "cd"),
        (100, "c"),
        (90, "xc"),
        (50, "l"),
        (40, "xl"),
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    ];
    let mut s = String::new();
    for (v, r) in table {
        while n >= v {
            s.push_str(r);
            n -= v;
        }
    }
    s
}

impl View<'_> {
    fn count(&mut self, n: usize) -> bool {
        self.nodes += n;
        self.nodes <= MAX_NODES
    }

    fn id_once(&mut self, id: &str) -> bool {
        self.used_ids.insert(id.to_string())
    }

    fn blocks(&mut self, blocks: &[Block], out: &mut Vec<Node>) {
        let mut lists: Vec<Frame> = Vec::new();
        let mut i = 0;
        while i < blocks.len() {
            if self.nodes > MAX_NODES {
                break;
            }
            match &blocks[i] {
                Block::Para(p) if p.list.is_some() && p.heading.is_none() => {
                    self.list_item(p, &mut lists, out);
                }
                Block::Para(p) => {
                    close_to(&mut lists, 0, out);
                    let caption = match blocks.get(i + 1) {
                        Some(Block::Para(c)) if c.kind == Kind::Caption && !c.text.is_empty() => {
                            Some(c)
                        }
                        _ => None,
                    };
                    let figure = caption.is_some() && image_only(p);
                    self.para(p, if figure { caption } else { None }, out);
                    if figure {
                        i += 1;
                    }
                }
                Block::Table(t) => {
                    close_to(&mut lists, 0, out);
                    let node = self.table(t);
                    out.push(Node::El(node));
                }
            }
            i += 1;
        }
        close_to(&mut lists, 0, out);
    }

    fn list_item(&mut self, p: &Para, lists: &mut Vec<Frame>, out: &mut Vec<Node>) {
        let Some(item) = p.list.as_ref() else { return };
        while lists.last().is_some_and(|top| top.level > item.level) {
            close_to(lists, lists.len() - 1, out);
        }
        // The same level of another list is a new list.
        if lists
            .last()
            .is_some_and(|top| top.level == item.level && top.num_id != item.num_id)
        {
            close_to(lists, lists.len() - 1, out);
        }
        if lists.last().is_none_or(|top| top.level < item.level) {
            let list = match &item.kind {
                ListKind::Ordered(kind) => {
                    let mut attrs = Vec::new();
                    if *kind != "1" {
                        attrs.push(("type", (*kind).to_string()));
                    }
                    if item.number != 1 {
                        attrs.push(("start", item.number.to_string()));
                    }
                    el("ol", attrs, Vec::new())
                }
                ListKind::Plain => el("ul", vec![("class", "aw-nobullet".into())], Vec::new()),
                ListKind::Bullet => el("ul", Vec::new(), Vec::new()),
            };
            lists.push(Frame {
                level: item.level,
                num_id: item.num_id,
                list,
                expect: item.number,
            });
        }
        let children = self.inlines(&p.inlines);
        let top = lists.last_mut().expect("a list is open");
        let mut attrs = Vec::new();
        if let Some(id) = &p.id {
            attrs.push(("id", id.clone()));
        }
        if matches!(item.kind, ListKind::Ordered(_)) && item.number != top.expect {
            attrs.push(("value", item.number.to_string()));
        }
        if p.rtl {
            attrs.push(("dir", "rtl".into()));
        }
        top.expect = item.number + 1;
        top.list.c.push(Node::El(el("li", attrs, children)));
        self.count(2);
        if p.break_after {
            close_to(lists, 0, out);
            out.push(Node::El(page_break()));
        }
    }

    fn para(&mut self, p: &Para, caption: Option<&Para>, out: &mut Vec<Node>) {
        if p.break_before {
            out.push(Node::El(page_break()));
        }
        if p.rule {
            out.push(Node::El(el("hr", Vec::new(), Vec::new())));
        } else if let Some(c) = caption {
            let mut figure = Vec::new();
            for inline in &p.inlines {
                if let Inline::Image(img) = inline {
                    figure.push(self.image(img));
                }
            }
            let mut attrs = Vec::new();
            if let Some(id) = &c.id {
                attrs.push(("id", id.clone()));
            }
            figure.push(Node::El(el("figcaption", attrs, self.inlines(&c.inlines))));
            out.push(Node::El(el("figure", Vec::new(), figure)));
            self.count(4);
        } else {
            let children = self.inlines(&p.inlines);
            let has_content =
                !p.text.is_empty() || p.inlines.iter().any(|i| matches!(i, Inline::Image(_)));
            if has_content {
                let mut attrs = Vec::new();
                if let Some(id) = &p.id {
                    attrs.push(("id", id.clone()));
                }
                if p.rtl {
                    attrs.push(("dir", "rtl".into()));
                }
                if !p.css.is_empty() {
                    attrs.push(("style", p.css.clone()));
                }
                let tag = match (p.heading, p.kind) {
                    (Some(1), _) => "h1",
                    (Some(2), _) => "h2",
                    (Some(3), _) => "h3",
                    (Some(4), _) => "h4",
                    (Some(5), _) => "h5",
                    (Some(_), _) => "h6",
                    (None, Kind::Title) => {
                        attrs.push(("class", "aw-title".into()));
                        "h1"
                    }
                    (None, Kind::Quote) => "blockquote",
                    (None, Kind::Code) => {
                        attrs.push(("class", "aw-code".into()));
                        "p"
                    }
                    (None, Kind::Caption) => {
                        attrs.push(("class", "aw-caption".into()));
                        "p"
                    }
                    (None, Kind::Normal) => "p",
                };
                out.push(Node::El(el(tag, attrs, children)));
                self.count(2);
            } else if !children.is_empty() {
                // Only places a link can lead to: kept, taking no room.
                out.push(Node::El(el("div", Vec::new(), children)));
            }
        }
        if p.break_after {
            out.push(Node::El(page_break()));
        }
    }

    fn table(&mut self, t: &Table) -> El {
        let (mut head, mut body): (Vec<Node>, Vec<Node>) = (Vec::new(), Vec::new());
        for row in &t.rows {
            let mut cells = Vec::new();
            for cell in row.cells.iter().filter(|c| !c.skip) {
                cells.push(Node::El(self.cell(cell)));
            }
            self.count(1 + cells.len());
            let tr = Node::El(el("tr", Vec::new(), cells));
            if row.header {
                head.push(tr);
            } else {
                body.push(tr);
            }
        }
        let mut children = Vec::new();
        if !head.is_empty() {
            children.push(Node::El(el("thead", Vec::new(), head)));
        }
        children.push(Node::El(el("tbody", Vec::new(), body)));
        el("table", Vec::new(), children)
    }

    fn cell(&mut self, c: &Cell) -> El {
        let mut attrs = Vec::new();
        if c.span > 1 {
            attrs.push(("colSpan", c.span.to_string()));
        }
        if c.row_span > 1 {
            attrs.push(("rowSpan", c.row_span.to_string()));
        }
        if c.header {
            attrs.push(("scope", "col".into()));
        }
        if let Some(fill) = &c.shade {
            attrs.push(("style", format!("background-color:#{fill}")));
        }
        let mut children = Vec::new();
        self.blocks(&c.blocks, &mut children);
        el(if c.header { "th" } else { "td" }, attrs, children)
    }

    fn notes(&mut self, out: &mut Vec<Node>) {
        for endnote in [false, true] {
            let mut items = Vec::new();
            for n in self.doc.notes.iter().filter(|n| n.endnote == endnote) {
                let mut children = Vec::new();
                self.blocks(&n.blocks, &mut children);
                if let Some((marker, part)) = self.doc.note_refs.get(&(n.endnote, n.id)) {
                    let item = match part {
                        Some(i) => self.doc.parts[*i].id.clone(),
                        None => NOTES_PART.to_string(),
                    };
                    let mut back = el(
                        "a",
                        vec![("role", "doc-backlink".into())],
                        vec![Node::Text("\u{21a9}".into())],
                    );
                    back.l = Some(LinkTarget {
                        item,
                        id: Some(marker.clone()),
                    });
                    match children.last_mut() {
                        Some(Node::El(last)) if last.t == "p" => {
                            last.c.push(Node::Text(" ".into()));
                            last.c.push(Node::El(back));
                        }
                        _ => children.push(Node::El(el("p", Vec::new(), vec![Node::El(back)]))),
                    }
                }
                let prefix = if n.endnote { "en" } else { "fn" };
                items.push(Node::El(el(
                    "li",
                    vec![("id", format!("{prefix}{}", n.id))],
                    children,
                )));
            }
            if items.is_empty() {
                continue;
            }
            if endnote && !out.is_empty() {
                out.push(Node::El(el("hr", Vec::new(), Vec::new())));
            }
            let attrs = if endnote {
                vec![("type", "i".to_string())]
            } else {
                Vec::new()
            };
            out.push(Node::El(el("ol", attrs, items)));
        }
    }

    /// Runs of text and what is between them, as nested elements.
    fn inlines(&mut self, items: &[Inline]) -> Vec<Node> {
        // Each open link has its own list of children; the first entry is the paragraph's.
        let mut stack: Vec<(Option<El>, Vec<Node>)> = vec![(None, Vec::new())];
        for item in items {
            if !self.count(1) {
                break;
            }
            let node = match item {
                Inline::Text(text, fmt) => Some(self.run(text, fmt)),
                Inline::Br => Some(Node::El(el("br", Vec::new(), Vec::new()))),
                Inline::Image(img) => Some(self.image(img)),
                Inline::Bookmark(name) => self.doc.bookmarks.get(name).and_then(|(id, _)| {
                    self.id_once(id)
                        .then(|| Node::El(el("span", vec![("id", id.clone())], Vec::new())))
                }),
                Inline::NoteRef(endnote, id) => self.note_ref(*endnote, *id),
                Inline::LinkStart(name) => {
                    let link = self.doc.bookmarks.get(name).map(|(id, part)| {
                        let mut a = el("a", Vec::new(), Vec::new());
                        a.l = Some(LinkTarget {
                            item: match part {
                                Some(i) => self.doc.parts[*i].id.clone(),
                                None => NOTES_PART.to_string(),
                            },
                            id: Some(id.clone()),
                        });
                        a
                    });
                    stack.push((link, Vec::new()));
                    None
                }
                Inline::LinkEnd => {
                    if stack.len() > 1 {
                        if let Some((link, children)) = stack.pop() {
                            let top = &mut stack.last_mut().expect("paragraph level").1;
                            match link {
                                Some(mut a) => {
                                    a.c = children;
                                    top.push(Node::El(a));
                                }
                                // Not a link we can follow: its text stays.
                                None => top.extend(children),
                            }
                        }
                    }
                    None
                }
            };
            if let Some(n) = node {
                stack.last_mut().expect("paragraph level").1.push(n);
            }
        }
        while stack.len() > 1 {
            if let Some((link, children)) = stack.pop() {
                let top = &mut stack.last_mut().expect("paragraph level").1;
                match link {
                    Some(mut a) => {
                        a.c = children;
                        top.push(Node::El(a));
                    }
                    None => top.extend(children),
                }
            }
        }
        stack.pop().map(|(_, c)| c).unwrap_or_default()
    }

    fn run(&self, text: &str, fmt: &Fmt) -> Node {
        let mut node = Node::Text(text.to_string());
        let wrap = |t: &'static str, attrs: Vec<(&'static str, String)>, inner: Node| {
            Node::El(el(t, attrs, vec![inner]))
        };
        // A relative size, a readable colour, and the capital styles.
        let mut style = Vec::new();
        if let Some(size) = fmt.size {
            let base = self.doc.base_size.max(1);
            let pct = (u64::from(size) * 100 / u64::from(base)).clamp(50, 300);
            let pct = (pct + 2) / 5 * 5;
            if pct != 100 {
                style.push(format!("font-size:{pct}%"));
            }
        }
        if let Some(color) = &fmt.color {
            if readable(color) {
                style.push(format!("color:#{color}"));
            }
        }
        if fmt.caps {
            style.push("text-transform:uppercase".into());
        } else if fmt.small_caps {
            style.push("font-variant:small-caps".into());
        }
        if !style.is_empty() {
            node = wrap("span", vec![("style", style.join(";"))], node);
        }
        if fmt.mono {
            node = wrap("code", Vec::new(), node);
        }
        if fmt.highlight {
            node = wrap("mark", Vec::new(), node);
        }
        if fmt.strike {
            node = wrap("s", Vec::new(), node);
        }
        if fmt.underline {
            node = wrap("u", Vec::new(), node);
        }
        if fmt.sup {
            node = wrap("sup", Vec::new(), node);
        } else if fmt.sub {
            node = wrap("sub", Vec::new(), node);
        }
        if fmt.italic {
            node = wrap("em", Vec::new(), node);
        }
        if fmt.bold {
            node = wrap("strong", Vec::new(), node);
        }
        node
    }

    fn note_ref(&mut self, endnote: bool, id: i64) -> Option<Node> {
        let note = self
            .doc
            .notes
            .iter()
            .find(|n| n.endnote == endnote && n.id == id)?;
        let label = if endnote {
            roman(note.label)
        } else {
            note.label.to_string()
        };
        let mut attrs = vec![("role", "doc-noteref".to_string())];
        let marker = self
            .doc
            .note_refs
            .get(&(endnote, id))
            .map(|(m, _)| m.clone())?;
        if self.id_once(&marker) {
            attrs.push(("id", marker));
        }
        let mut a = el("a", attrs, vec![Node::Text(label)]);
        a.l = Some(LinkTarget {
            item: NOTES_PART.to_string(),
            id: Some(format!("{}{id}", if endnote { "en" } else { "fn" })),
        });
        Some(Node::El(el("sup", Vec::new(), vec![Node::El(a)])))
    }

    /// A picture of the package as a `data:` URL, or its description standing in.
    fn image(&mut self, img: &ImageRef) -> Node {
        match self.image_data(img) {
            Some(url) => {
                let mut attrs = vec![("src", url), ("alt", img.alt.clone())];
                if let (Some(w), Some(h)) = (img.width, img.height) {
                    let shown = w.min(MAX_IMAGE_WIDTH);
                    let scaled = (u64::from(h) * u64::from(shown) / u64::from(w.max(1))).max(1);
                    attrs.push(("width", shown.to_string()));
                    attrs.push(("height", scaled.to_string()));
                } else if let Some(w) = img.width {
                    attrs.push(("width", w.min(MAX_IMAGE_WIDTH).to_string()));
                }
                Node::El(el("img", attrs, Vec::new()))
            }
            None => {
                self.missing += 1;
                let children = if img.alt.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![Node::Text(img.alt.clone())]
                };
                Node::El(el(
                    "span",
                    vec![("class", "aw-missing-image".into())],
                    children,
                ))
            }
        }
    }

    fn image_data(&mut self, img: &ImageRef) -> Option<String> {
        let rel = self.doc.rels.get(&img.rid).filter(|r| !r.external)?;
        let path = resolve_target(&self.doc.dir, &rel.target)?;
        let mime = image_mime(&path)?;
        let mut entry = self.archive.by_name(&path).ok()?;
        let size = entry.size();
        if size == 0 || size > MAX_IMAGE_BYTES || self.image_bytes + size > MAX_IMAGES_TOTAL {
            return None;
        }
        let mut data = Vec::with_capacity(size as usize);
        entry
            .by_ref()
            .take(MAX_IMAGE_BYTES + 1)
            .read_to_end(&mut data)
            .ok()?;
        if data.len() as u64 > MAX_IMAGE_BYTES {
            return None;
        }
        self.image_bytes += size;
        Some(format!("data:{mime};base64,{}", base64(&data)))
    }
}

fn image_only(p: &Para) -> bool {
    p.text.is_empty()
        && p.list.is_none()
        && p.heading.is_none()
        && p.inlines.iter().any(|i| matches!(i, Inline::Image(_)))
}

fn page_break() -> El {
    el(
        "hr",
        vec![
            ("class", "aw-pagebreak".into()),
            ("role", "doc-pagebreak".into()),
        ],
        Vec::new(),
    )
}

/// A text colour that stays readable on the white page.
fn readable(hex: &str) -> bool {
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return false;
    }
    let v = |i: usize| f64::from(u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)) / 255.0;
    0.2126 * v(0) + 0.7152 * v(2) + 0.0722 * v(4) < 0.62
}
