//! EPUB (2 and 3): metadata from the package document (OPF), text from the
//! spine in reading order. Chapters come from each document's first
//! heading; deeper headings form the section path. EPUBs have no fixed
//! pages, so none are invented. Scripts and styles are skipped; nothing in
//! the book is executed.
//!
//! The book's own table of contents (EPUB 3 navigation document, EPUB 2 NCX)
//! is read on demand from the managed file by [`contents`], and each entry is
//! mapped to the position of the extracted segment it leads to. Nothing is
//! stored for it, and nothing is generated when a book has none.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use quick_xml::events::Event;

use super::html_entities::NAMED;
use quick_xml::Reader;

use super::{
    collapse, split_long, ExtractionStatus, FoundMetadata, ImportedDocument, NewSegment,
    SourceImportAdapter,
};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::contents::{
    clean_title, ContentsItem, ContentsTarget, SourceLink, MAX_DEPTH, MAX_ITEMS, MAX_LINKS,
};

pub struct EpubImporter;

const MAX_SEGMENT: usize = 1_500;
pub(super) const MAX_ENTRY_BYTES: u64 = 20 * 1024 * 1024;

impl SourceImportAdapter for EpubImporter {
    fn format(&self) -> &'static str {
        "epub"
    }

    fn accepts(&self, extension: &str) -> bool {
        extension == "epub"
    }

    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument> {
        read_book(bytes, file_name, false).map(|book| book.document)
    }
}

/// The book's own contents, each entry pointing at the segment (by position
/// in the extracted text) it leads to. Empty when the book has no usable
/// contents, or when its text no longer matches what was imported
/// (`expected_segments`), since positions could then be wrong. Never fails
/// the book: anything unreadable simply yields no contents.
pub fn contents(bytes: &[u8], expected_segments: usize) -> Vec<ContentsItem> {
    match read_book(bytes, "book.epub", true) {
        Ok(book) if book.document.segments.len() == expected_segments => book.items,
        _ => Vec::new(),
    }
}

/// The links inside the book's text that lead to another place in the same
/// book: where the link is (segment position and the character range of its
/// text, in UTF-16 units as the interface counts them) and the segment it
/// leads to. External links, links to anything outside the reading order and
/// links to an anchor that does not exist are left out, so a link the
/// reader shows always has somewhere to go. Empty when the text no longer
/// matches what was imported. Nothing is stored; it is read from the
/// managed file each time, like the contents.
pub fn links(bytes: &[u8], expected_segments: usize) -> Vec<SourceLink> {
    match read_book(bytes, "book.epub", false) {
        Ok(book) if book.document.segments.len() == expected_segments => book.links,
        _ => Vec::new(),
    }
}

/// The reading order of a book as the formatted view needs it: for each
/// document that was read, where its text starts among the extracted segments
/// and which segment each of its anchors falls in. Empty when the text no
/// longer matches what was imported (`expected_segments`).
pub fn structure(bytes: &[u8], expected_segments: usize) -> Vec<super::epub_view::StructureItem> {
    let Ok(book) = read_book(bytes, "book.epub", false) else {
        return Vec::new();
    };
    if book.document.segments.len() != expected_segments {
        return Vec::new();
    }
    let layout = &book.layout;
    let mut items = Vec::with_capacity(layout.order.len());
    for (index, (id, path)) in layout.order.iter().enumerate() {
        let Some(doc) = layout.docs.get(path) else {
            continue;
        };
        let end = layout
            .order
            .get(index + 1)
            .and_then(|(_, next)| layout.docs.get(next))
            .map_or(layout.total, |next| next.first);
        items.push(super::epub_view::StructureItem {
            id: id.clone(),
            start_segment: doc.first as i64,
            segment_count: end.saturating_sub(doc.first) as i64,
            anchors: doc
                .anchors
                .iter()
                .map(|(name, at)| {
                    (
                        name.clone(),
                        (*at).min(layout.total.saturating_sub(1)) as i64,
                    )
                })
                .collect(),
        });
    }
    items
}

struct Book {
    document: ImportedDocument,
    items: Vec<ContentsItem>,
    links: Vec<SourceLink>,
    layout: Layout,
}

/// A link found in a segment, before its target is looked up.
struct PendingLink {
    position: usize,
    start: usize,
    end: usize,
    /// The archive path of the document the link is in.
    doc: String,
    href: String,
}

/// Where each spine document's text starts, and where its anchors fall, in
/// the numbering of the extracted segments.
#[derive(Default)]
pub(super) struct Layout {
    docs: HashMap<String, DocLayout>,
    total: usize,
    /// (manifest id, archive path) of each document that was read, in reading order.
    order: Vec<(String, String)>,
}

#[derive(Default)]
struct DocLayout {
    first: usize,
    anchors: HashMap<String, usize>,
}

impl Layout {
    /// The segment a (document, fragment) leads to: the anchor's own segment
    /// if the fragment is known, else the document's first. None if the
    /// document is not part of the reading order or the book has no text.
    fn position(&self, path: &str, fragment: Option<&str>) -> Option<i64> {
        let doc = self.docs.get(path)?;
        let at = fragment
            .and_then(|f| doc.anchors.get(f).copied())
            .unwrap_or(doc.first);
        (self.total > 0).then(|| at.min(self.total - 1) as i64)
    }
}

impl Layout {
    /// As [`Layout::position`] for a link, but exact: a fragment the document
    /// does not have leads nowhere (it is not turned into the document's start).
    fn link_position(&self, path: &str, fragment: Option<&str>) -> Option<i64> {
        let doc = self.docs.get(path)?;
        let at = match fragment {
            Some(f) => *doc.anchors.get(f)?,
            None => doc.first,
        };
        (self.total > 0).then(|| at.min(self.total - 1) as i64)
    }
}

fn read_book(bytes: &[u8], file_name: &str, want_contents: bool) -> AppResult<Book> {
    let bad = |why: &str| {
        AppError::Import(
            UserMessage::new(
                "library.badEpub",
                format!("“{file_name}” could not be read as an EPUB book ({why})."),
            )
            .with("fileName", file_name),
        )
    };
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| bad("not a valid archive"))?;
    let container =
        read_entry(&mut archive, "META-INF/container.xml").ok_or_else(|| bad("no container"))?;
    let opf_path = attribute_of(&container, "rootfile", "full-path")
        .ok_or_else(|| bad("no package document"))?;
    let opf = read_entry(&mut archive, &opf_path).ok_or_else(|| bad("package document missing"))?;
    let base = opf_path
        .rsplit_once('/')
        .map(|(dir, _)| format!("{dir}/"))
        .unwrap_or_default();
    let package = parse_package(&opf);
    if package.spine.is_empty() {
        return Err(bad("no reading order"));
    }

    let mut segments = Vec::new();
    let mut pending: Vec<PendingLink> = Vec::new();
    let mut layout = Layout::default();
    let mut chapters = 0u32;
    for idref in &package.spine {
        let Some(item) = package.manifest.get(idref) else {
            continue;
        };
        let path = normalise(&format!("{base}{}", item.href));
        let Some(xhtml) = read_entry(&mut archive, &path) else {
            continue;
        };
        let (blocks, anchors) = blocks(&xhtml);
        let chapter = blocks
            .iter()
            .find(|b| b.heading_level.is_some())
            .map(|b| b.text.clone());
        if chapter.is_some() {
            chapters += 1;
        }
        let mut doc = DocLayout {
            first: segments.len(),
            anchors: HashMap::new(),
        };
        // Segments emitted before each block, to place anchors among them.
        let mut before = Vec::with_capacity(blocks.len() + 1);
        let mut headings: Vec<Option<String>> = vec![None; 6];
        let mut paragraph = 0u32;
        for block in blocks {
            before.push(segments.len());
            if let Some(level) = block.heading_level {
                headings[level - 1] = Some(block.text);
                for deeper in headings.iter_mut().skip(level) {
                    *deeper = None;
                }
                paragraph = 0;
                continue;
            }
            let names: Vec<&str> = headings.iter().flatten().map(String::as_str).collect();
            let section_path = (!names.is_empty()).then(|| names.join(" › "));
            let heading = headings.iter().rev().flatten().next().cloned();
            let mut cursor = 0usize;
            for part in split_long(&block.text, MAX_SEGMENT) {
                // Where this segment sits in the block, to place the block's links in it.
                let at = block.text[cursor..]
                    .find(part.as_str())
                    .map_or(cursor, |i| cursor + i);
                cursor = at + part.len();
                let first = block.text[..at].chars().count();
                let last = first + part.chars().count();
                for link in &block.links {
                    let (from, to) = (link.start.max(first), link.end.min(last));
                    if from < to && pending.len() < MAX_LINKS {
                        let units =
                            |n: usize| -> usize { part.chars().take(n).map(char::len_utf16).sum() };
                        pending.push(PendingLink {
                            position: segments.len(),
                            start: units(from - first),
                            end: units(to - first),
                            doc: path.clone(),
                            href: link.href.clone(),
                        });
                    }
                }
                segments.push(NewSegment {
                    text: part,
                    chapter: chapter.clone(),
                    heading: heading.clone(),
                    section_path: section_path.clone().or_else(|| chapter.clone()),
                    paragraph_index: Some(paragraph),
                    ..Default::default()
                });
                paragraph += 1;
            }
        }
        before.push(segments.len());
        for (id, block_index) in anchors {
            let at = before.get(block_index).copied().unwrap_or(segments.len());
            doc.anchors.entry(id).or_insert(at);
        }
        layout.order.push((idref.clone(), path.clone()));
        layout.docs.entry(path).or_insert(doc);
    }
    layout.total = segments.len();

    let items = if want_contents {
        read_contents(&mut archive, &package, &base, &layout)
    } else {
        Vec::new()
    };
    let links = resolve_links(pending, &layout);
    Ok(Book {
        document: ImportedDocument {
            format: "epub",
            metadata: package.metadata,
            segments,
            extraction_status: ExtractionStatus::DigitalText,
            page_count: None,
            chapter_count: Some(chapters),
        },
        items,
        links,
        layout,
    })
}

/// Looks up where each link leads, by the book's own structure (the archive
/// path of the document and the anchor in it); never by matching text.
fn resolve_links(pending: Vec<PendingLink>, layout: &Layout) -> Vec<SourceLink> {
    pending
        .into_iter()
        .filter_map(|link| {
            let dir = link.doc.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
            let (path, fragment) = link_target(dir, &link.doc, &link.href)?;
            let target = layout.link_position(&path, fragment.as_deref())?;
            Some(SourceLink {
                position: link.position as i64,
                start: link.start,
                end: link.end,
                target,
            })
        })
        .collect()
}

/// An `href` found in the document `doc` (in directory `dir`) as an internal
/// (archive path, fragment): a bare `#id` is in the same document; anything
/// external, scripted or leaving the book is None (see [`internal_target`]).
fn link_target(dir: &str, doc: &str, href: &str) -> Option<(String, Option<String>)> {
    let href = href.trim();
    if let Some(fragment) = href.strip_prefix('#') {
        return (!fragment.is_empty()).then(|| (doc.to_string(), Some(percent_decode(fragment))));
    }
    internal_target(dir, href)
}

pub(super) fn read_entry(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > MAX_ENTRY_BYTES {
        return None;
    }
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

/// Resolves "OEBPS/text/../images/a.xhtml" style paths inside the archive.
pub(super) fn normalise(path: &str) -> String {
    let path = path.split('#').next().unwrap_or(path);
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    parts.join("/")
}

pub(super) fn local_name(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

pub(super) fn attribute_of(xml: &str, element: &str, attribute: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().allow_dangling_amp = true;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) if local_name(e.name().as_ref()) == element => {
                return e
                    .attributes()
                    .flatten()
                    .find(|a| local_name(a.key.as_ref()) == attribute)
                    .map(|a| a.value.to_string());
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
    }
}

pub(super) struct ManifestItem {
    pub(super) href: String,
    pub(super) media_type: String,
    pub(super) properties: String,
}

pub(super) struct Package {
    pub(super) metadata: FoundMetadata,
    pub(super) manifest: HashMap<String, ManifestItem>,
    pub(super) spine: Vec<String>,
    /// The spine's `toc` attribute: the manifest id of the NCX (EPUB 2).
    pub(super) ncx_id: Option<String>,
}

pub(super) fn parse_package(opf: &str) -> Package {
    let mut reader = Reader::from_str(opf);
    reader.config_mut().allow_dangling_amp = true;
    let mut metadata = FoundMetadata::default();
    let mut manifest = HashMap::new();
    let mut spine = Vec::new();
    let mut ncx_id = None;
    let mut current: Option<String> = None;
    let mut scheme_isbn = false;
    let mut buffer = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_string();
                if name == "spine" {
                    ncx_id = e
                        .attributes()
                        .flatten()
                        .find(|a| local_name(a.key.as_ref()) == "toc")
                        .map(|a| a.value.to_string());
                }
                scheme_isbn = e.attributes().flatten().any(|a| {
                    local_name(a.key.as_ref()) == "scheme" && a.value.eq_ignore_ascii_case("isbn")
                });
                current = Some(name);
                buffer.clear();
            }
            Ok(Event::Empty(e)) => {
                let name = local_name(e.name().as_ref()).to_string();
                let attr = |key: &str| {
                    e.attributes()
                        .flatten()
                        .find(|a| local_name(a.key.as_ref()) == key)
                        .map(|a| a.value.to_string())
                };
                if name == "item" {
                    if let (Some(id), Some(href)) = (attr("id"), attr("href")) {
                        manifest.insert(
                            id,
                            ManifestItem {
                                href: percent_decode(&href),
                                media_type: attr("media-type").unwrap_or_default(),
                                properties: attr("properties").unwrap_or_default(),
                            },
                        );
                    }
                } else if name == "itemref" {
                    if let Some(id) = attr("idref") {
                        spine.push(id);
                    }
                }
            }
            Ok(Event::Text(t)) => buffer.push_str(&t),
            Ok(Event::GeneralRef(r)) => buffer.push_str(&unescape(&format!("&{};", &*r))),
            Ok(Event::End(_)) => {
                let text = collapse(&buffer);
                buffer.clear();
                if !text.is_empty() {
                    let set = |slot: &mut Option<String>| {
                        if slot.is_none() {
                            *slot = Some(text.clone());
                        }
                    };
                    match current.as_deref() {
                        Some("title") => set(&mut metadata.title),
                        Some("creator") => set(&mut metadata.author),
                        Some("language") => set(&mut metadata.language),
                        Some("publisher") => set(&mut metadata.publisher),
                        Some("identifier") => {
                            let digits: String =
                                text.chars().filter(char::is_ascii_digit).collect();
                            let looks_isbn = scheme_isbn
                                || text.to_ascii_lowercase().contains("isbn")
                                || (digits.len() == 13 && digits.starts_with("97"));
                            if looks_isbn && metadata.isbn.is_none() {
                                metadata.isbn =
                                    Some(text.trim_start_matches("urn:isbn:").to_string());
                            } else {
                                set(&mut metadata.identifier);
                            }
                        }
                        _ => {}
                    }
                }
                current = None;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    Package {
        metadata,
        manifest,
        spine,
        ncx_id,
    }
}

pub(super) fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct Block {
    text: String,
    heading_level: Option<usize>,
    /// Links in the text, as character ranges of `text`.
    links: Vec<RawLink>,
}

struct RawLink {
    start: usize,
    end: usize,
    href: String,
}

struct OpenLink {
    href: String,
    start: Option<usize>,
}

/// The text of the block being read, collapsed as it grows (runs of white
/// space become one space, none at either end: what `collapse` gives), with
/// the character ranges of the links inside it.
#[derive(Default)]
struct Acc {
    text: String,
    chars: usize,
    pending_space: bool,
    links: Vec<RawLink>,
    open: Option<OpenLink>,
}

impl Acc {
    fn push_str(&mut self, piece: &str) {
        for ch in piece.chars() {
            if ch.is_whitespace() {
                self.pending_space = true;
                continue;
            }
            if self.pending_space && self.chars > 0 {
                self.text.push(' ');
                self.chars += 1;
            }
            self.pending_space = false;
            if let Some(open) = self.open.as_mut() {
                open.start.get_or_insert(self.chars);
            }
            self.text.push(ch);
            self.chars += 1;
        }
    }

    fn open_link(&mut self, href: String) {
        self.close_link();
        self.open = Some(OpenLink { href, start: None });
    }

    fn close_link(&mut self) {
        if let Some(open) = self.open.take() {
            if let Some(start) = open.start.filter(|s| *s < self.chars) {
                self.links.push(RawLink {
                    start,
                    end: self.chars,
                    href: open.href,
                });
            }
        }
    }

    /// The finished block's text and links. A link still open carries on into the next block.
    fn take(&mut self) -> (String, Vec<RawLink>) {
        let carry = self.open.as_ref().map(|o| o.href.clone());
        self.close_link();
        let out = (
            std::mem::take(&mut self.text),
            std::mem::take(&mut self.links),
        );
        self.chars = 0;
        self.pending_space = false;
        self.open = carry.map(|href| OpenLink { href, start: None });
        out
    }
}

/// Block-level text of an XHTML document: headings and paragraphs (p, li,
/// blockquote, dd, dt, pre, and text directly in div/section). Tolerant of
/// imperfect markup; character references are decoded by [`unescape`].
fn blocks(xhtml: &str) -> (Vec<Block>, Vec<(String, usize)>) {
    let mut reader = tolerant_reader(xhtml);
    let mut out = Vec::new();
    // Elements with an id, and the index of the block they begin in or at.
    let mut anchors: Vec<(String, usize)> = Vec::new();
    let mut acc = Acc::default();
    let mut heading: Option<usize> = None;
    let mut skip_depth = 0usize;
    let flush = |out: &mut Vec<Block>, acc: &mut Acc, heading: Option<usize>| {
        let (text, links) = acc.take();
        if !text.is_empty() {
            out.push(Block {
                text,
                heading_level: heading,
                links,
            });
        }
    };
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                match name.as_str() {
                    "script" | "style" | "head" => skip_depth += 1,
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        flush(&mut out, &mut acc, heading);
                        heading = Some((name.as_bytes()[1] - b'0') as usize);
                    }
                    "p" | "li" | "blockquote" | "dd" | "dt" | "pre" | "div" | "section" | "tr" => {
                        flush(&mut out, &mut acc, heading);
                    }
                    "a" if skip_depth == 0 => {
                        if let Some(href) = attr_value(&e, "href") {
                            acc.open_link(href);
                        }
                    }
                    _ => {}
                }
                note_anchor(&e, out.len(), &mut anchors);
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                match name.as_str() {
                    "script" | "style" | "head" => skip_depth = skip_depth.saturating_sub(1),
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        flush(&mut out, &mut acc, heading);
                        heading = None;
                    }
                    "p" | "li" | "blockquote" | "dd" | "dt" | "pre" | "div" | "section" | "tr" => {
                        flush(&mut out, &mut acc, heading);
                    }
                    "a" => acc.close_link(),
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) if local_name(e.name().as_ref()).eq_ignore_ascii_case("br") => {
                acc.push_str(" ")
            }
            Ok(Event::Empty(e)) => note_anchor(&e, out.len(), &mut anchors),
            // Entities arrive separately (GeneralRef), so text is used as is.
            Ok(Event::Text(t)) if skip_depth == 0 => acc.push_str(&t),
            Ok(Event::CData(t)) if skip_depth == 0 => acc.push_str(&t),
            Ok(Event::GeneralRef(r)) if skip_depth == 0 => {
                acc.push_str(&unescape(&format!("&{};", &*r)))
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    flush(&mut out, &mut acc, heading);
    (out, anchors)
}

fn note_anchor(
    e: &quick_xml::events::BytesStart,
    block: usize,
    anchors: &mut Vec<(String, usize)>,
) {
    for a in e.attributes().flatten() {
        let key = local_name(a.key.as_ref());
        if key == "id" || (key == "name" && local_name(e.name().as_ref()) == "a") {
            anchors.push((percent_decode(&a.value), block));
        }
    }
}

/// An XML reader for a book's own files, as forgiving as a browser where that
/// is safe: end tags need not match, and an `&` that does not begin a complete
/// reference ("Q&A", "&dagger" without its `;`) is kept as text. Without the
/// latter the reader stops with an error and the rest of the document is lost.
pub(super) fn tolerant_reader(xml: &str) -> Reader<&[u8]> {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.check_end_names = false;
    config.allow_dangling_amp = true;
    reader
}

/// Decodes character references in one pass, as an HTML parser does: every
/// HTML5 named reference (`&bull;`, `&nbsp;`, `&rdquo;`, …), decimal and hex
/// references. The output is never scanned again, so `&amp;bull;` becomes the
/// text "&bull;", not "•". Unknown names and a lone `&` are kept as written.
/// Numeric references follow the HTML standard: 128–159 are read as
/// Windows-1252 (what authors meant by `&#146;`), and impossible values (0,
/// surrogates, beyond Unicode) become U+FFFD. The result is plain text, never
/// markup.
pub(super) fn unescape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        // The longest HTML5 name has 31 characters; numeric references are shorter.
        let Some(end) = tail.find(';').filter(|e| (2..=33).contains(e)) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..end];
        let numeric = |digits: &str, radix: u32| -> Option<char> {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return None;
            }
            let code = u32::from_str_radix(digits, radix).unwrap_or(u32::MAX);
            Some(match code {
                0x80..=0x9F => windows_1252(code),
                0 | 0xD800..=0xDFFF | 0x11_0000.. => '\u{FFFD}',
                _ => char::from_u32(code).unwrap_or('\u{FFFD}'),
            })
        };
        let decoded: Option<std::borrow::Cow<str>> = if let Some(hex) = entity
            .strip_prefix("#x")
            .or_else(|| entity.strip_prefix("#X"))
        {
            numeric(hex, 16).map(|c| c.to_string().into())
        } else if let Some(dec) = entity.strip_prefix('#') {
            numeric(dec, 10).map(|c| c.to_string().into())
        } else {
            NAMED
                .binary_search_by(|(name, _)| (*name).cmp(entity))
                .ok()
                .map(|i| NAMED[i].1.into())
        };
        match decoded {
            Some(text) => out.push_str(&text),
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

/// [`unescape`], for code outside the adapters: every character reference in
/// `raw` decoded once, never recursively.
pub fn decode_references_once(raw: &str) -> String {
    unescape(raw)
}

/// What an HTML parser reads for a C1 control character U+0080–U+009F (the
/// Windows-1252 character with that code); any other character is returned as it is.
pub fn c1_as_windows_1252(c: char) -> char {
    match c as u32 {
        code @ 0x80..=0x9F => windows_1252(code),
        _ => c,
    }
}

/// The HTML standard's reading of numeric references 128–159 (Windows-1252).
fn windows_1252(code: u32) -> char {
    const TABLE: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž',
        '\u{8F}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}',
        'ž', 'Ÿ',
    ];
    TABLE[(code - 0x80) as usize]
}

// --- The book's own contents ---------------------------------------------------

#[derive(Default)]
struct RawItem {
    title: String,
    href: Option<String>,
    children: Vec<RawItem>,
}

/// The navigation document if there is one (EPUB 3), else the NCX (EPUB 2).
fn read_contents(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    package: &Package,
    base: &str,
    layout: &Layout,
) -> Vec<ContentsItem> {
    let nav = package
        .manifest
        .values()
        .find(|i| i.properties.split_whitespace().any(|p| p == "nav"));
    let ncx = package
        .ncx_id
        .as_ref()
        .and_then(|id| package.manifest.get(id))
        .or_else(|| {
            package
                .manifest
                .values()
                .find(|i| i.media_type == "application/x-dtbncx+xml")
        });
    for (item, is_nav) in [(nav, true), (ncx, false)] {
        let Some(item) = item else { continue };
        let path = normalise(&format!("{base}{}", item.href));
        let Some(xml) = read_entry(archive, &path) else {
            continue;
        };
        let dir = path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        let raw = if is_nav {
            parse_nav(&xml)
        } else {
            parse_ncx(&xml)
        };
        let mut counter = 0usize;
        let items = convert(raw, 0, dir, layout, &mut counter);
        if !items.is_empty() {
            return items;
        }
    }
    Vec::new()
}

fn convert(
    raw: Vec<RawItem>,
    depth: usize,
    dir: &str,
    layout: &Layout,
    counter: &mut usize,
) -> Vec<ContentsItem> {
    let mut out = Vec::new();
    for item in raw {
        if *counter >= MAX_ITEMS {
            break;
        }
        let title = clean_title(&item.title);
        let id = format!("n{counter}");
        if !title.is_empty() {
            *counter += 1;
        }
        let children = if depth + 1 < MAX_DEPTH {
            convert(item.children, depth + 1, dir, layout, counter)
        } else {
            Vec::new()
        };
        if title.is_empty() {
            // An untitled wrapper: its children still count.
            out.extend(children);
            continue;
        }
        let target = item
            .href
            .as_deref()
            .and_then(|href| internal_target(dir, href))
            .and_then(|(path, fragment)| layout.position(&path, fragment.as_deref()))
            .map(|position| ContentsTarget::Segment { position });
        if target.is_none() && children.is_empty() {
            continue; // nowhere to go (external, outside the book, or not in reading order)
        }
        out.push(ContentsItem {
            id,
            title,
            target,
            children,
        });
    }
    out
}

/// An href as an internal (path in the archive, fragment), or None for
/// anything else: an external or scripted link (`https:`, `javascript:`,
/// `data:` …), an absolute path, backslashes, or a path that climbs out of
/// the book.
pub(super) fn internal_target(dir: &str, href: &str) -> Option<(String, Option<String>)> {
    let href = href.trim();
    let (path, fragment) = match href.split_once('#') {
        Some((p, f)) => (p, Some(f)),
        None => (href, None),
    };
    let first_segment = path.split('/').next().unwrap_or("");
    if path.is_empty()
        || first_segment.contains(':')
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
    {
        return None;
    }
    let path = percent_decode(path);
    if path.contains('\\') || path.contains('\0') {
        return None;
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?; // climbing above the book's root
            }
            p => parts.push(p),
        }
    }
    Some((parts.join("/"), fragment.map(percent_decode)))
}

pub(super) fn attr_value(e: &quick_xml::events::BytesStart, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| local_name(a.key.as_ref()) == key)
        .map(|a| a.value.to_string())
}

/// EPUB 3: the `<nav epub:type="toc">` list, nested `ol > li > (a | span, ol)`.
fn parse_nav(xhtml: &str) -> Vec<RawItem> {
    enum Frame {
        List(Vec<RawItem>),
        Item(RawItem),
    }
    let mut reader = tolerant_reader(xhtml);
    let mut in_toc = false;
    let mut stack: Vec<Frame> = Vec::new();
    let mut root = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                if !in_toc {
                    in_toc = name == "nav"
                        && attr_value(&e, "type")
                            .is_some_and(|t| t.split_whitespace().any(|w| w == "toc"));
                    continue;
                }
                match name.as_str() {
                    "ol" => stack.push(Frame::List(Vec::new())),
                    "li" => stack.push(Frame::Item(RawItem::default())),
                    "a" => {
                        if let Some(Frame::Item(item)) = stack.last_mut() {
                            if item.href.is_none() {
                                item.href = attr_value(&e, "href");
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) if in_toc => {
                match local_name(e.name().as_ref()).to_ascii_lowercase().as_str() {
                    "ol" => {
                        if let Some(Frame::List(items)) = stack.pop() {
                            match stack.last_mut() {
                                Some(Frame::Item(parent)) => parent.children = items,
                                _ => root = items,
                            }
                        }
                    }
                    "li" => {
                        if let Some(Frame::Item(item)) = stack.pop() {
                            if let Some(Frame::List(list)) = stack.last_mut() {
                                list.push(item);
                            }
                        }
                    }
                    "nav" => break,
                    _ => {}
                }
            }
            Ok(Event::Text(t)) if in_toc => {
                if let Some(Frame::Item(item)) = stack.last_mut() {
                    item.title.push_str(&t);
                }
            }
            Ok(Event::GeneralRef(r)) if in_toc => {
                if let Some(Frame::Item(item)) = stack.last_mut() {
                    item.title.push_str(&unescape(&format!("&{};", &*r)));
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    root
}

/// EPUB 2: the NCX `navMap`, nested `navPoint > (navLabel > text, content, navPoint…)`.
fn parse_ncx(xml: &str) -> Vec<RawItem> {
    let mut reader = tolerant_reader(xml);
    let mut stack: Vec<RawItem> = Vec::new();
    let mut root = Vec::new();
    let mut in_label = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match local_name(e.name().as_ref()) {
                "navPoint" => stack.push(RawItem::default()),
                "navLabel" => in_label = true,
                "content" => {
                    if let Some(item) = stack.last_mut() {
                        item.href = item.href.take().or_else(|| attr_value(&e, "src"));
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) if local_name(e.name().as_ref()) == "content" => {
                if let Some(item) = stack.last_mut() {
                    item.href = item.href.take().or_else(|| attr_value(&e, "src"));
                }
            }
            Ok(Event::End(e)) => match local_name(e.name().as_ref()) {
                "navLabel" => in_label = false,
                "navPoint" => {
                    if let Some(done) = stack.pop() {
                        match stack.last_mut() {
                            Some(parent) => parent.children.push(done),
                            None => root.push(done),
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) if in_label => {
                if let Some(item) = stack.last_mut() {
                    item.title.push_str(&t);
                }
            }
            Ok(Event::GeneralRef(r)) if in_label => {
                if let Some(item) = stack.last_mut() {
                    item.title.push_str(&unescape(&format!("&{};", &*r)));
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_follow_headings_and_skip_scripts() {
        let (found, _) = blocks(
            "<html><head><title>x</title><style>p{}</style></head><body>\
             <h1>Chapter One</h1><p>First &amp; <em>best</em>.</p>\
             <script>alert('no')</script><h2>A Part</h2><p>Second&nbsp;line<br/>continues.</p>\
             <ul><li>Item</li></ul></body></html>",
        );
        let seen: Vec<_> = found
            .iter()
            .map(|b| (b.text.as_str(), b.heading_level))
            .collect();
        assert_eq!(
            seen,
            [
                ("Chapter One", Some(1)),
                ("First & best.", None),
                ("A Part", Some(2)),
                ("Second line continues.", None),
                ("Item", None),
            ]
        );
    }

    #[test]
    fn paths_and_entities_resolve() {
        assert_eq!(normalise("OEBPS/text/../ch1.xhtml#top"), "OEBPS/ch1.xhtml");
        assert_eq!(
            unescape("A &#8212; B &#x2019; &unknown; &"),
            "A — B ’ &unknown; &"
        );
        assert_eq!(percent_decode("chapter%201.xhtml"), "chapter 1.xhtml");
    }

    #[test]
    fn character_references_decode_like_html_once() {
        // named references from the whole HTML5 list, not only XML's five
        assert_eq!(
            unescape("&bull; one &amp; two &mdash; three"),
            "• one & two — three"
        );
        assert_eq!(
            unescape("&ldquo;Abide&rdquo; &lsquo;in&rsquo; me&hellip;"),
            "“Abide” ‘in’ me…"
        );
        assert_eq!(
            unescape("a&nbsp;b"),
            "a\u{a0}b",
            "a non-breaking space stays one"
        );
        assert_eq!(
            unescape("&CounterClockwiseContourIntegral;"),
            "∳",
            "the longest name"
        );
        // decimal and hex, either case
        assert_eq!(unescape("&#8226;&#x2022;&#X2022;"), "•••");
        // Windows-1252 readings of 128–159, and impossible values
        assert_eq!(unescape("don&#146;t &#150; &#128;"), "don’t – €");
        assert_eq!(
            unescape("&#0;&#xD800;&#1114112;"),
            "\u{FFFD}\u{FFFD}\u{FFFD}"
        );
        // never decoded twice: an escaped ampersand stays text
        assert_eq!(unescape("&amp;bull; &amp;amp;"), "&bull; &amp;");
        // already-decoded text and unknown or malformed references are left alone
        assert_eq!(unescape("• — “quote” 한국어"), "• — “quote” 한국어");
        assert_eq!(
            unescape("&unknown; & &; &#; &#xZZ; &bull"),
            "&unknown; & &; &#; &#xZZ; &bull"
        );
        // markup characters come out as text, never as markup to interpret
        assert_eq!(unescape("&lt;script&gt;"), "<script>");
    }

    #[test]
    fn only_internal_targets_are_followed() {
        let ok = |h| internal_target("OEBPS/text", h);
        assert_eq!(
            ok("ch1.xhtml#s2"),
            Some(("OEBPS/text/ch1.xhtml".into(), Some("s2".into())))
        );
        assert_eq!(
            ok("../ch%202.xhtml"),
            Some(("OEBPS/ch 2.xhtml".into(), None))
        );
        for bad in [
            "https://example.org/x",
            "HTTP://x",
            "javascript:alert(1)",
            "data:text/html,x",
            "file:///etc/passwd",
            "mailto:a@b.c",
            "/etc/passwd",
            "..\\..\\x.xhtml",
            "../../../etc/passwd",
            "../../../../x.xhtml",
            "#only-a-fragment",
            "",
        ] {
            assert_eq!(ok(bad), None, "{bad}");
        }
    }
}
