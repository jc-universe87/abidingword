//! The formatted view of an EPUB: one reading-order document at a time,
//! turned into a small typed tree the interface renders itself.
//!
//! An EPUB's pages are untrusted content. Nothing here hands markup to the
//! web view. The document is read from the managed file, parsed, and
//! rebuilt from an allow-list: only known elements and attributes survive,
//! text is data, scripts/styles/frames/objects/forms and everything else are
//! dropped, and the interface turns the tree into elements one by one. The
//! rules, in short:
//!
//! - **Elements**: a fixed list of text, list, table, figure and image
//!   elements. Any other element is unwrapped (its text stays) or, for the
//!   dangerous ones (script, style, frames, objects, SVG, MathML, media,
//!   forms), dropped with its content.
//! - **Attributes**: a fixed list. No event handlers, no `href`/`src` as
//!   written, no `style` as written (see below).
//! - **Links**: a link to another place in the same book becomes a target
//!   (reading-order document id and element id); a link to the web, a script,
//!   a path leaving the book or a document outside the reading order becomes
//!   plain text. Nothing is ever opened by the page.
//! - **Images**: only files inside the book, found by their archive path
//!   (relative paths resolved against the document; a path climbing out of the
//!   book is refused), of a known image type, within a size limit, and sent as
//!   `data:` URLs. Anything else (remote, missing, too big) is replaced by its
//!   alternative text, not silently dropped.
//! - **Styles**: the book's own style sheets (inside the book) and `<style>`
//!   elements and `style` attributes are cut down to a list of harmless
//!   typographic and box properties. No `url()`, no `@import`/`@font-face`/any
//!   at-rule, no positioning, no `content`. Font sizes are bounded.
//!
//! Nothing is stored and nothing is written: it is all derived from the file.

use std::collections::{BTreeMap, HashMap};
use std::io::{Cursor, Read};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;

use super::epub::{
    attr_value, attribute_of, internal_target, local_name, normalise, parse_package,
    percent_decode, read_entry, unescape, Package, MAX_ENTRY_BYTES,
};
use crate::error::{AppError, AppResult, UserMessage};

/// The largest image sent to the interface, and the most image data for one document.
pub const MAX_IMAGE_BYTES: u64 = 6 * 1024 * 1024;
pub(super) const MAX_IMAGES_TOTAL: u64 = 40 * 1024 * 1024;
/// The most style sheet text kept for one document.
const MAX_CSS_BYTES: usize = 1024 * 1024;
const MAX_RULES: usize = 6_000;
const MAX_NODES: usize = 400_000;
const MAX_DEPTH: usize = 96;
const MAX_ID_CHARS: usize = 300;

/// Where one reading-order document starts among the extracted text, for
/// moving between Reading and Original without guessing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureItem {
    /// The package's own id for the document: stable, and the only way the
    /// interface names a document.
    pub id: String,
    /// The segment its text starts at.
    pub start_segment: i64,
    pub segment_count: i64,
    /// Each element id in it and the segment that element falls in.
    pub anchors: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Node {
    Text(String),
    El(El),
}

/// One allowed element: its tag, attributes and children, and, for a link, where it leads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct El {
    pub t: &'static str,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub a: BTreeMap<&'static str, String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub c: Vec<Node>,
    /// Present on a link to another place in the book.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub l: Option<LinkTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkTarget {
    /// The reading-order document it leads to.
    pub item: String,
    /// The element in it, if the link names one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// One document, ready to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubItem {
    pub id: String,
    pub nodes: Vec<Node>,
    /// The document's own style, reduced to what is safe, for the page it is in.
    pub css: String,
    /// What the `<body>` carried (class, id and style), for the element that stands in for it.
    pub root: BTreeMap<&'static str, String>,
    /// Images that could not be shown (missing, too large, outside the book).
    pub missing_images: u32,
}

fn unavailable() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "library.originalUnavailable",
        "The original of this source can’t be opened.",
    ))
}

type Archive<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

fn open_package(bytes: &[u8]) -> AppResult<(Archive<'_>, Package, String)> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| unavailable())?;
    let container = read_entry(&mut archive, "META-INF/container.xml").ok_or_else(unavailable)?;
    let opf_path = attribute_of(&container, "rootfile", "full-path").ok_or_else(unavailable)?;
    let opf = read_entry(&mut archive, &opf_path).ok_or_else(unavailable)?;
    let base = opf_path
        .rsplit_once('/')
        .map(|(dir, _)| format!("{dir}/"))
        .unwrap_or_default();
    Ok((archive, parse_package(&opf), base))
}

/// One reading-order document of the book, sanitised. `item_id` is the
/// package's id for it (from [`StructureItem::id`]); anything else is refused.
pub fn render_item(bytes: &[u8], item_id: &str) -> AppResult<EpubItem> {
    let (mut archive, package, base) = open_package(bytes)?;
    if !package.spine.iter().any(|id| id == item_id) {
        return Err(unavailable());
    }
    let manifest = package.manifest.get(item_id).ok_or_else(unavailable)?;
    let path = normalise(&format!("{base}{}", manifest.href));
    let xhtml = read_entry(&mut archive, &path).ok_or_else(unavailable)?;
    // Which reading-order document each archive path is, to resolve links.
    let mut by_path: HashMap<String, String> = HashMap::new();
    for id in &package.spine {
        if let Some(item) = package.manifest.get(id) {
            by_path
                .entry(normalise(&format!("{base}{}", item.href)))
                .or_insert_with(|| id.clone());
        }
    }
    let dir = path
        .rsplit_once('/')
        .map(|(d, _)| d)
        .unwrap_or("")
        .to_string();
    let mut resources = Resources {
        archive: &mut archive,
        dir: &dir,
        doc: &path,
        by_path: &by_path,
        image_bytes: 0,
        missing_images: 0,
        css_files: Vec::new(),
    };
    let parsed = parse_document(&xhtml, &mut resources);
    let mut css = String::new();
    for file in std::mem::take(&mut resources.css_files) {
        css.push_str(&file);
        css.push('\n');
    }
    css.push_str(&parsed.css);
    Ok(EpubItem {
        id: item_id.to_string(),
        nodes: parsed.nodes,
        css: cap_css(css),
        root: parsed.root,
        missing_images: resources.missing_images,
    })
}

fn cap_css(mut css: String) -> String {
    if css.len() > MAX_CSS_BYTES {
        let mut end = MAX_CSS_BYTES;
        while !css.is_char_boundary(end) {
            end -= 1;
        }
        css.truncate(end);
    }
    css
}

/// What the parser may ask of the book.
struct Resources<'a, 'b> {
    archive: &'a mut Archive<'b>,
    /// The document's directory and path in the archive.
    dir: &'a str,
    doc: &'a str,
    by_path: &'a HashMap<String, String>,
    image_bytes: u64,
    missing_images: u32,
    /// Sanitised text of the style sheets the document links to.
    css_files: Vec<String>,
}

/// An `href` as a link target inside the book, or None (external, scripted,
/// leaving the book, or not a reading-order document).
fn link_for(res: &Resources, href: &str) -> Option<LinkTarget> {
    let href = href.trim();
    let (path, fragment) = if let Some(fragment) = href.strip_prefix('#') {
        (res.doc.to_string(), Some(percent_decode(fragment)))
    } else {
        internal_target(res.dir, href)?
    };
    let item = res.by_path.get(&path)?.clone();
    Some(LinkTarget {
        item,
        id: fragment.filter(|f| !f.is_empty() && f.chars().count() <= MAX_ID_CHARS),
    })
}

pub(super) fn image_mime(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    match lower.rsplit_once('.').map(|(_, ext)| ext)? {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

pub(super) fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// An image of the book as a `data:` URL, or None.
fn image_for(res: &mut Resources, src: &str) -> Option<String> {
    let (path, _) = internal_target(res.dir, src)?;
    let mime = image_mime(&path)?;
    let mut entry = res.archive.by_name(&path).ok()?;
    let size = entry.size();
    if size == 0 || size > MAX_IMAGE_BYTES || res.image_bytes + size > MAX_IMAGES_TOTAL {
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
    res.image_bytes += size;
    Some(format!("data:{mime};base64,{}", base64(&data)))
}

// --- the document ----------------------------------------------------------

struct Parsed {
    nodes: Vec<Node>,
    css: String,
    root: BTreeMap<&'static str, String>,
}

/// Elements kept, by the tag the interface will draw.
fn kept(name: &str) -> Option<&'static str> {
    Some(match name {
        "h1" => "h1",
        "h2" => "h2",
        "h3" => "h3",
        "h4" => "h4",
        "h5" => "h5",
        "h6" => "h6",
        "p" => "p",
        "div" | "section" | "article" | "aside" | "nav" | "header" | "footer" | "main"
        | "center" => "div",
        "span" | "bdi" | "bdo" | "font" => "span",
        "blockquote" => "blockquote",
        "pre" => "pre",
        "code" => "code",
        "em" => "em",
        "i" => "i",
        "strong" => "strong",
        "b" => "b",
        "u" | "ins" => "u",
        "s" | "strike" | "del" => "s",
        "small" => "small",
        "sub" => "sub",
        "sup" => "sup",
        "mark" => "mark",
        "cite" => "cite",
        "q" => "q",
        "abbr" => "abbr",
        "dfn" => "dfn",
        "kbd" => "kbd",
        "samp" => "samp",
        "var" => "var",
        "time" => "time",
        "ruby" => "ruby",
        "rt" => "rt",
        "rp" => "rp",
        "br" => "br",
        "hr" => "hr",
        "ul" => "ul",
        "ol" => "ol",
        "li" => "li",
        "dl" => "dl",
        "dt" => "dt",
        "dd" => "dd",
        "table" => "table",
        "thead" => "thead",
        "tbody" => "tbody",
        "tfoot" => "tfoot",
        "tr" => "tr",
        "td" => "td",
        "th" => "th",
        "caption" => "caption",
        "colgroup" => "colgroup",
        "col" => "col",
        "figure" => "figure",
        "figcaption" => "figcaption",
        "img" => "img",
        "a" => "a",
        _ => return None,
    })
}

/// Elements whose content is never shown.
fn dropped(name: &str) -> bool {
    matches!(
        name,
        "script"
            | "style"
            | "head"
            | "title"
            | "noscript"
            | "iframe"
            | "frame"
            | "frameset"
            | "object"
            | "embed"
            | "applet"
            | "template"
            | "svg"
            | "math"
            | "audio"
            | "video"
            | "canvas"
            | "textarea"
            | "select"
            | "button"
            | "form"
            | "map"
            | "base"
            | "meta"
            | "link"
    )
}

fn is_void(name: &str) -> bool {
    matches!(
        name,
        "br" | "hr"
            | "img"
            | "col"
            | "wbr"
            | "meta"
            | "link"
            | "input"
            | "base"
            | "area"
            | "param"
            | "source"
            | "track"
    )
}

/// Elements whose children are only other elements: whitespace between them is not content.
fn structural(tag: &str) -> bool {
    matches!(
        tag,
        "table" | "thead" | "tbody" | "tfoot" | "tr" | "colgroup" | "ul" | "ol" | "dl"
    )
}

enum Kind {
    Keep(El),
    Unwrap,
    Drop,
}

struct Open {
    name: String,
    kind: Kind,
    children: Vec<Node>,
}

/// A table's rows written straight inside it (valid XML, but not how a web
/// page's table is built) are put in a body, as a browser would, so the
/// interface can draw it as a real table.
fn with_body(children: Vec<Node>) -> Vec<Node> {
    let is_row = |n: &Node| matches!(n, Node::El(e) if e.t == "tr");
    if !children.iter().any(is_row) {
        return children;
    }
    let mut out: Vec<Node> = Vec::new();
    let mut rows: Vec<Node> = Vec::new();
    let flush = |out: &mut Vec<Node>, rows: &mut Vec<Node>| {
        if !rows.is_empty() {
            out.push(Node::El(El {
                t: "tbody",
                a: BTreeMap::new(),
                c: std::mem::take(rows),
                l: None,
            }));
        }
    };
    for child in children {
        if is_row(&child) {
            rows.push(child);
        } else {
            flush(&mut out, &mut rows);
            out.push(child);
        }
    }
    flush(&mut out, &mut rows);
    out
}

fn push_text(into: &mut Vec<Node>, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(Node::Text(last)) = into.last_mut() {
        last.push_str(text);
    } else {
        into.push(Node::Text(text.to_string()));
    }
}

fn parse_document(xhtml: &str, res: &mut Resources) -> Parsed {
    let mut reader = Reader::from_str(xhtml);
    reader.config_mut().check_end_names = false;
    let mut root_nodes: Vec<Node> = Vec::new();
    let mut stack: Vec<Open> = Vec::new();
    let mut css = String::new();
    let mut root: BTreeMap<&'static str, String> = BTreeMap::new();
    let mut in_style = false;
    let mut style_text = String::new();
    let mut nodes = 0usize;
    let mut dropping = 0usize;
    // Inside <head>: its text is never shown, but its style sheets and <style> are read.
    let mut in_head = false;

    // Where finished children go.
    fn add(root_nodes: &mut Vec<Node>, stack: &mut [Open], node: Node) {
        match stack.last_mut() {
            Some(top) => top.children.push(node),
            None => root_nodes.push(node),
        }
    }

    // Closes the top element, handing what it made to its parent.
    fn close(root_nodes: &mut Vec<Node>, stack: &mut Vec<Open>, dropping: &mut usize) {
        let Some(open) = stack.pop() else { return };
        match open.kind {
            Kind::Drop => *dropping = dropping.saturating_sub(1),
            Kind::Unwrap => {
                for child in open.children {
                    add(root_nodes, stack, child);
                }
            }
            Kind::Keep(mut el) => {
                let mut children = open.children;
                if structural(el.t) {
                    children.retain(|c| !matches!(c, Node::Text(t) if t.trim().is_empty()));
                }
                if el.t == "table" {
                    children = with_body(children);
                }
                el.c = children;
                add(root_nodes, stack, Node::El(el));
            }
        }
    }

    loop {
        let event = reader.read_event();
        match event {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let is_empty = matches!(event, Ok(Event::Empty(_)));
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                let void = is_empty || is_void(&name);

                if name == "body" || name == "html" {
                    if name == "body" {
                        for (key, value) in clean_attrs("div", e, true) {
                            root.insert(key, value);
                        }
                    }
                    if !void {
                        stack.push(Open {
                            name,
                            kind: Kind::Unwrap,
                            children: Vec::new(),
                        });
                    }
                    continue;
                }
                if name == "link" && (dropping == 0 || in_head) {
                    stylesheet(e, res);
                    continue;
                }
                if name == "style" && !void && (dropping == 0 || in_head) {
                    in_style = true;
                    style_text.clear();
                    stack.push(Open {
                        name,
                        kind: Kind::Drop,
                        children: Vec::new(),
                    });
                    dropping += 1;
                    continue;
                }

                if name == "head" && !void {
                    in_head = true;
                }
                let kind = if dropping > 0 || dropped(&name) {
                    Kind::Drop
                } else if stack.len() >= MAX_DEPTH || nodes >= MAX_NODES {
                    Kind::Unwrap
                } else {
                    match kept(&name) {
                        None => Kind::Unwrap,
                        Some(tag) => match element(tag, &name, e, res) {
                            Some(el) => {
                                nodes += 1;
                                Kind::Keep(el)
                            }
                            None => Kind::Unwrap,
                        },
                    }
                };
                if void {
                    // A void or self-closed element has no content: finish it at once.
                    match kind {
                        Kind::Keep(el) => {
                            let node = Node::El(el);
                            add(&mut root_nodes, &mut stack, node);
                        }
                        Kind::Unwrap | Kind::Drop => {}
                    }
                } else {
                    if matches!(kind, Kind::Drop) {
                        dropping += 1;
                    }
                    stack.push(Open {
                        name,
                        kind,
                        children: Vec::new(),
                    });
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                // Close down to the nearest open element of this name; a stray end tag closes nothing.
                if name == "head" {
                    in_head = false;
                }
                if let Some(at) = stack.iter().rposition(|o| o.name == name) {
                    while stack.len() > at {
                        if stack.len() == at + 1 && name == "style" && in_style {
                            in_style = false;
                            css.push_str(&sanitize_css(&style_text));
                            css.push('\n');
                        }
                        close(&mut root_nodes, &mut stack, &mut dropping);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if in_style {
                    style_text.push_str(&t);
                } else if dropping == 0 {
                    let top = stack.last_mut().map(|o| &mut o.children);
                    push_text(top.unwrap_or(&mut root_nodes), &t);
                }
            }
            Ok(Event::CData(t)) => {
                let text: String = t.to_string();
                if in_style {
                    style_text.push_str(&text);
                } else if dropping == 0 {
                    let top = stack.last_mut().map(|o| &mut o.children);
                    push_text(top.unwrap_or(&mut root_nodes), &text);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                let text = unescape(&format!("&{};", &*r));
                if in_style {
                    style_text.push_str(&text);
                } else if dropping == 0 {
                    let top = stack.last_mut().map(|o| &mut o.children);
                    push_text(top.unwrap_or(&mut root_nodes), &text);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    while !stack.is_empty() {
        close(&mut root_nodes, &mut stack, &mut dropping);
    }
    Parsed {
        nodes: root_nodes,
        css,
        root,
    }
}

/// A `<link rel="stylesheet">` to a file of the book: its sanitised text is kept.
fn stylesheet(e: &BytesStart, res: &mut Resources) {
    let rel = attr_value(e, "rel")
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !rel.split_whitespace().any(|r| r == "stylesheet") {
        return;
    }
    let Some(href) = attr_value(e, "href") else {
        return;
    };
    let Some((path, _)) = internal_target(res.dir, &href) else {
        return;
    };
    let is_css = path.to_ascii_lowercase().ends_with(".css");
    if !is_css {
        return;
    }
    let Some(text) = read_entry(res.archive, &path) else {
        return;
    };
    if text.len() as u64 > MAX_ENTRY_BYTES || text.len() > MAX_CSS_BYTES {
        return;
    }
    res.css_files.push(sanitize_css(&text));
}

/// A kept element with its allowed attributes, or None to unwrap it instead
/// (a link that leads nowhere inside the book has no use as a link).
fn element(tag: &'static str, name: &str, e: &BytesStart, res: &mut Resources) -> Option<El> {
    let mut attrs = clean_attrs(tag, e, false);
    let mut link = None;
    let mut tag = tag;
    if tag == "a" {
        match attr_value(e, "href") {
            Some(href) => match link_for(res, &href) {
                Some(target) => link = Some(target),
                None => {
                    // An external, scripted or broken link is not a link here; keep any anchor it names.
                    if attrs.contains_key("id") {
                        tag = "span";
                    } else {
                        return None;
                    }
                }
            },
            None => {
                // A target without a destination: a place other links can point at.
                if let Some(name) = attr_value(e, "name") {
                    attrs.entry("id").or_insert_with(|| clip(&name));
                }
                if attrs.contains_key("id") {
                    tag = "span";
                } else {
                    return None;
                }
            }
        }
    }
    if tag == "img" {
        let alt = attr_value(e, "alt").unwrap_or_default();
        let shown = attr_value(e, "src").and_then(|src| image_for(res, &src));
        match shown {
            Some(url) => {
                attrs.insert("src", url);
                attrs.insert("alt", alt);
            }
            None => {
                // The picture is not available: its description stands in, visibly.
                res.missing_images += 1;
                let mut stand_in = BTreeMap::new();
                stand_in.insert("class", "aw-missing-image".to_string());
                let mut el = El {
                    t: "span",
                    a: stand_in,
                    c: Vec::new(),
                    l: None,
                };
                if !alt.trim().is_empty() {
                    el.c.push(Node::Text(alt));
                }
                return Some(el);
            }
        }
    }
    let _ = name;
    Some(El {
        t: tag,
        a: attrs,
        c: Vec::new(),
        l: link,
    })
}

fn clip(value: &str) -> String {
    value.chars().take(MAX_ID_CHARS).collect()
}

fn token_safe(value: &str) -> bool {
    value
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ' ' | '.' | ':'))
}

fn digits_or_percent(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty()
        && v.len() <= 8
        && v.trim_end_matches('%').chars().all(|c| c.is_ascii_digit())
        && v.matches('%').count() <= 1
}

/// The attributes an element may keep, cleaned. Never `href`, `src` or an event handler.
fn clean_attrs(tag: &str, e: &BytesStart, _body: bool) -> BTreeMap<&'static str, String> {
    let mut out: BTreeMap<&'static str, String> = BTreeMap::new();
    for a in e.attributes().flatten() {
        let raw_key = a.key.as_ref().to_ascii_lowercase();
        let value = unescape(&a.value);
        let key = local_name(&raw_key);
        let is_epub_type = raw_key == "epub:type" || (key == "type" && raw_key.contains(':'));
        match (key, is_epub_type) {
            ("type", true) => {
                if let Some(role) = epub_role(&value) {
                    out.insert("role", role.to_string());
                }
            }
            ("id", _) if !value.is_empty() => {
                out.insert("id", clip(&value));
            }
            ("class", _) if token_safe(&value) => {
                out.insert("class", value.chars().take(200).collect());
            }
            ("lang", _) if token_safe(&value) && value.len() <= 20 => {
                out.insert("lang", value);
            }
            ("dir", _) if matches!(value.as_str(), "ltr" | "rtl" | "auto") => {
                out.insert("dir", value);
            }
            ("title", _) => {
                out.insert("title", value.chars().take(300).collect());
            }
            ("colspan", _) | ("rowspan", _) if matches!(tag, "td" | "th") => {
                if let Ok(n) = value.trim().parse::<u32>() {
                    if (1..=1000).contains(&n) {
                        let name: &'static str = if key == "colspan" {
                            "colSpan"
                        } else {
                            "rowSpan"
                        };
                        out.insert(name, n.to_string());
                    }
                }
            }
            ("scope", _)
                if matches!(tag, "td" | "th")
                    && matches!(value.as_str(), "row" | "col" | "rowgroup" | "colgroup") =>
            {
                out.insert("scope", value);
            }
            ("start", _) if tag == "ol" => {
                if let Ok(n) = value.trim().parse::<i32>() {
                    out.insert("start", n.to_string());
                }
            }
            ("type", false)
                if tag == "ol" && matches!(value.as_str(), "1" | "a" | "A" | "i" | "I") =>
            {
                out.insert("type", value);
            }
            ("value", _) if tag == "li" => {
                if let Ok(n) = value.trim().parse::<i32>() {
                    out.insert("value", n.to_string());
                }
            }
            ("width", _) | ("height", _)
                if matches!(tag, "img" | "table" | "col") && digits_or_percent(&value) =>
            {
                let name: &'static str = if key == "width" { "width" } else { "height" };
                out.insert(name, value.trim().to_string());
            }
            ("style", _) => {
                let style = sanitize_declarations(&value);
                if !style.is_empty() {
                    out.insert("style", style);
                }
            }
            _ => {}
        }
    }
    out
}

/// The ARIA role (a fixed list) for an `epub:type`, so notes keep their meaning.
fn epub_role(epub_type: &str) -> Option<&'static str> {
    for word in epub_type.split_whitespace() {
        let role = match word {
            "noteref" => "doc-noteref",
            "footnote" => "doc-footnote",
            "endnote" | "rearnote" => "doc-endnote",
            "pagebreak" => "doc-pagebreak",
            "backlink" => "doc-backlink",
            _ => continue,
        };
        return Some(role);
    }
    None
}

// --- styles ----------------------------------------------------------------

/// Properties a document may set: typography, spacing, borders and lists.
/// Nothing that positions, hides content behind other content, loads a
/// resource, or reaches outside the element.
const ALLOWED: &[&str] = &[
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "font-variant",
    "font-variant-caps",
    "font-variant-numeric",
    "font-variant-ligatures",
    "font-kerning",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-align",
    "text-indent",
    "text-transform",
    "text-decoration",
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-color",
    "vertical-align",
    "white-space",
    "hyphens",
    "direction",
    "unicode-bidi",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-width",
    "border-style",
    "border-color",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-collapse",
    "border-spacing",
    "border-radius",
    "list-style-type",
    "list-style-position",
    "display",
    "float",
    "clear",
    "width",
    "max-width",
    "min-width",
    "table-layout",
    "caption-side",
    "empty-cells",
    "quotes",
];

const DISPLAY_VALUES: &[&str] = &[
    "none",
    "block",
    "inline",
    "inline-block",
    "list-item",
    "table",
    "table-row",
    "table-cell",
    "table-row-group",
    "table-header-group",
    "table-footer-group",
    "table-caption",
    "table-column",
    "table-column-group",
];

fn alias(property: &str) -> &str {
    match property {
        "-epub-hyphens" | "-webkit-hyphens" => "hyphens",
        "-epub-text-align-last" => "text-align-last",
        other => other,
    }
}

/// One declaration's value if it is harmless, else None.
fn safe_value(property: &str, raw: &str) -> Option<String> {
    let mut value = raw.trim().to_string();
    // `!important` would let a book override the reader's own protections.
    if let Some(at) = value.to_ascii_lowercase().find("!important") {
        value.truncate(at);
        value = value.trim().to_string();
    }
    if value.is_empty() || value.len() > 200 {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    if lower.contains("url(")
        || lower.contains("expression")
        || lower.contains("javascript")
        || lower.contains("behavior")
        || lower.contains("binding")
        || lower.contains("image(")
        || lower.contains("image-set")
        || lower.contains("attr(")
        || lower.contains("var(")
        || lower.contains("env(")
        || lower.contains("@")
        || lower.contains("\\")
        || lower.contains("/*")
    {
        return None;
    }
    if !value.chars().all(|c| {
        c.is_alphanumeric()
            || matches!(
                c,
                ' ' | '.' | '#' | '%' | ',' | '-' | '+' | '(' | ')' | '/' | '"' | '\'' | '_'
            )
    }) {
        return None;
    }
    if property == "display" && !DISPLAY_VALUES.contains(&lower.as_str()) {
        return None;
    }
    if property == "float" && !matches!(lower.as_str(), "left" | "right" | "none") {
        return None;
    }
    if property == "font-size" {
        return Some(bound_font_size(&value));
    }
    Some(value)
}

/// A font size a book sets is kept within what stays readable: between 0.7
/// and 3 times the size it inherits. Keywords (small, large, …) are left alone.
fn bound_font_size(value: &str) -> String {
    let v = value.trim();
    let split = v
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(v.len());
    let (number, unit) = v.split_at(split);
    if !number.is_empty()
        && number.parse::<f32>().is_ok()
        && matches!(unit, "em" | "rem" | "%" | "px" | "pt")
    {
        format!("clamp(0.7em, {v}, 3em)")
    } else {
        v.to_string()
    }
}

/// The declarations of one style (an attribute, or the inside of a rule), reduced to the allowed ones.
fn sanitize_declarations(text: &str) -> String {
    let mut out = String::new();
    for declaration in text.split(';') {
        let Some((property, value)) = declaration.split_once(':') else {
            continue;
        };
        let property = property.trim().to_ascii_lowercase();
        let property = alias(&property);
        if !ALLOWED.contains(&property) {
            continue;
        }
        if let Some(value) = safe_value(property, value) {
            out.push_str(property);
            out.push(':');
            out.push_str(&value);
            out.push(';');
        }
    }
    out
}

fn selector_safe(selector: &str) -> bool {
    !selector.trim().is_empty()
        && selector.len() <= 300
        && selector.chars().all(|c| {
            c.is_alphanumeric()
                || matches!(
                    c,
                    ' ' | '.'
                        | '#'
                        | '>'
                        | '+'
                        | '~'
                        | ','
                        | '*'
                        | ':'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '='
                        | '"'
                        | '\''
                        | '-'
                        | '_'
                        | '^'
                        | '$'
                        | '|'
                )
        })
}

/// Replaces the whole word `word` in a selector with `with` (`body` → the element standing in for it).
fn replace_word(selector: &str, word: &str, with: &str) -> String {
    let chars: Vec<char> = selector.chars().collect();
    let target: Vec<char> = word.chars().collect();
    let ident = |c: char| c.is_alphanumeric() || c == '-' || c == '_';
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let before_ok =
            i == 0 || !(ident(chars[i - 1]) || chars[i - 1] == '.' || chars[i - 1] == '#');
        if before_ok
            && chars[i..].starts_with(&target)
            && chars.get(i + target.len()).is_none_or(|c| !ident(*c))
        {
            out.push_str(with);
            i += target.len();
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn scope_selector(selector: &str) -> String {
    let mut s = selector.trim().to_string();
    for word in ["html", "body"] {
        s = replace_word(&s, word, ".aw-doc");
    }
    s = s.replace(":root", ".aw-doc");
    while s.contains(".aw-doc .aw-doc") {
        s = s.replace(".aw-doc .aw-doc", ".aw-doc");
    }
    s
}

/// A style sheet cut down to plain rules of allowed declarations. At-rules
/// (`@import`, `@font-face`, `@media`, …) are dropped whole; so is any rule
/// whose selector has anything unusual in it.
pub fn sanitize_css(css: &str) -> String {
    // Comments first (so nothing hides in them).
    let mut clean = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        clean.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => {
                rest = "";
                break;
            }
        }
    }
    clean.push_str(rest);

    let mut out = String::new();
    let mut rules = 0usize;
    let bytes: Vec<char> = clean.chars().collect();
    let mut i = 0;
    while i < bytes.len() && rules < MAX_RULES {
        // The prelude: up to the next `{`.
        let start = i;
        while i < bytes.len() && bytes[i] != '{' && bytes[i] != ';' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let prelude: String = bytes[start..i].iter().collect();
        if bytes[i] == ';' {
            i += 1; // `@import …;` and the like
            continue;
        }
        // The block, with nesting.
        let block_start = i + 1;
        let mut depth = 1;
        i += 1;
        while i < bytes.len() && depth > 0 {
            match bytes[i] {
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        let end = if depth == 0 { i - 1 } else { i };
        let prelude = prelude.trim();
        if prelude.starts_with('@') || depth > 0 {
            continue; // at-rules are not kept
        }
        let block: String = bytes[block_start..end.max(block_start)].iter().collect();
        if block.contains('{') {
            continue;
        }
        let declarations = sanitize_declarations(&block);
        if declarations.is_empty() || !selector_safe(prelude) {
            continue;
        }
        let selectors: Vec<String> = prelude
            .split(',')
            .map(scope_selector)
            .filter(|s| !s.is_empty())
            .collect();
        if selectors.is_empty() {
            continue;
        }
        out.push_str(&selectors.join(","));
        out.push('{');
        out.push_str(&declarations);
        out.push_str("}\n");
        rules += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declarations_keep_only_harmless_properties() {
        let css = sanitize_declarations(
            "color: red; position: fixed; top: 0; background-image: url(http://x/y); background-color: #fff; \
             z-index: 99; font-size: 12px !important; content: 'x'; margin-left: 2em; behavior: url(x.htc)",
        );
        assert_eq!(
            css,
            "color:red;background-color:#fff;font-size:clamp(0.7em, 12px, 3em);margin-left:2em;"
        );
    }

    #[test]
    fn values_with_resources_or_scripts_are_refused() {
        for bad in [
            "url(a.png)",
            "expression(alert(1))",
            "javascript:x",
            "var(--x)",
            "red\\9",
            "a;b",
            "attr(x)",
        ] {
            assert!(safe_value("color", bad).is_none(), "{bad}");
        }
        assert!(safe_value("display", "flex").is_none());
        assert!(safe_value("display", "block").is_some());
        assert!(safe_value("float", "inherit").is_none());
    }

    #[test]
    fn sheets_lose_at_rules_and_odd_selectors() {
        let css = sanitize_css(
            "@import url(http://evil/x.css); @font-face { font-family: X; src: url(x.woff); } \
             @media print { p { color: red } } body { margin: 0; position: absolute } \
             p.note, html h1 { color: #333 } a[href^=\"http\"]:hover { color: red } \
             div > p { text-indent: 1em } x{color:red}} .bad<script>{color:red} /* p { color: blue } */",
        );
        assert!(!css.contains("evil") && !css.contains("font-face") && !css.contains("@media"));
        assert!(!css.contains("script") && !css.contains("blue"));
        assert!(css.contains(".aw-doc{margin:0;}"));
        assert!(css.contains("p.note,.aw-doc h1{color:#333;}"));
        assert!(css.contains("div > p{text-indent:1em;}"));
    }
}
