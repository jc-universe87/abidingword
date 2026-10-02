//! EPUB (2 and 3): metadata from the package document (OPF), text from the
//! spine in reading order. Chapters come from each document's first
//! heading; deeper headings form the section path. EPUBs have no fixed
//! pages, so none are invented. Scripts and styles are skipped; nothing in
//! the book is executed.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{
    collapse, split_long, ExtractionStatus, FoundMetadata, ImportedDocument, NewSegment,
    SourceImportAdapter,
};
use crate::error::{AppError, AppResult, UserMessage};

pub struct EpubImporter;

const MAX_SEGMENT: usize = 1_500;
const MAX_ENTRY_BYTES: u64 = 20 * 1024 * 1024;

impl SourceImportAdapter for EpubImporter {
    fn format(&self) -> &'static str {
        "epub"
    }

    fn accepts(&self, extension: &str) -> bool {
        extension == "epub"
    }

    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument> {
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
        let container = read_entry(&mut archive, "META-INF/container.xml")
            .ok_or_else(|| bad("no container"))?;
        let opf_path = attribute_of(&container, "rootfile", "full-path")
            .ok_or_else(|| bad("no package document"))?;
        let opf =
            read_entry(&mut archive, &opf_path).ok_or_else(|| bad("package document missing"))?;
        let base = opf_path
            .rsplit_once('/')
            .map(|(dir, _)| format!("{dir}/"))
            .unwrap_or_default();
        let package = parse_package(&opf);
        if package.spine.is_empty() {
            return Err(bad("no reading order"));
        }

        let mut segments = Vec::new();
        let mut chapters = 0u32;
        for idref in &package.spine {
            let Some(href) = package.manifest.get(idref) else {
                continue;
            };
            let path = normalise(&format!("{base}{href}"));
            let Some(xhtml) = read_entry(&mut archive, &path) else {
                continue;
            };
            let blocks = blocks(&xhtml);
            let chapter = blocks
                .iter()
                .find(|b| b.heading_level.is_some())
                .map(|b| b.text.clone());
            if chapter.is_some() {
                chapters += 1;
            }
            let mut headings: Vec<Option<String>> = vec![None; 6];
            let mut paragraph = 0u32;
            for block in blocks {
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
                for part in split_long(&block.text, MAX_SEGMENT) {
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
        }
        Ok(ImportedDocument {
            format: "epub",
            metadata: package.metadata,
            segments,
            extraction_status: ExtractionStatus::DigitalText,
            page_count: None,
            chapter_count: Some(chapters),
        })
    }
}

fn read_entry(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > MAX_ENTRY_BYTES {
        return None;
    }
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

/// Resolves "OEBPS/text/../images/a.xhtml" style paths inside the archive.
fn normalise(path: &str) -> String {
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

fn local_name(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn attribute_of(xml: &str, element: &str, attribute: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
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

struct Package {
    metadata: FoundMetadata,
    manifest: HashMap<String, String>,
    spine: Vec<String>,
}

fn parse_package(opf: &str) -> Package {
    let mut reader = Reader::from_str(opf);
    let mut metadata = FoundMetadata::default();
    let mut manifest = HashMap::new();
    let mut spine = Vec::new();
    let mut current: Option<String> = None;
    let mut scheme_isbn = false;
    let mut buffer = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_string();
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
                        manifest.insert(id, percent_decode(&href));
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
    }
}

fn percent_decode(value: &str) -> String {
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
}

/// Block-level text of an XHTML document: headings and paragraphs (p, li,
/// blockquote, dd, dt, pre, and text directly in div/section). Tolerant of
/// imperfect markup; HTML entities outside XML's five are kept as written.
fn blocks(xhtml: &str) -> Vec<Block> {
    let mut reader = Reader::from_str(xhtml);
    reader.config_mut().check_end_names = false;
    let mut out = Vec::new();
    let mut text = String::new();
    let mut heading: Option<usize> = None;
    let mut skip_depth = 0usize;
    let flush = |out: &mut Vec<Block>, text: &mut String, heading: Option<usize>| {
        let collapsed = collapse(text);
        if !collapsed.is_empty() {
            out.push(Block {
                text: collapsed,
                heading_level: heading,
            });
        }
        text.clear();
    };
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                match name.as_str() {
                    "script" | "style" | "head" => skip_depth += 1,
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        flush(&mut out, &mut text, heading);
                        heading = Some((name.as_bytes()[1] - b'0') as usize);
                    }
                    "p" | "li" | "blockquote" | "dd" | "dt" | "pre" | "div" | "section" | "tr" => {
                        flush(&mut out, &mut text, heading);
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.name().as_ref()).to_ascii_lowercase();
                match name.as_str() {
                    "script" | "style" | "head" => skip_depth = skip_depth.saturating_sub(1),
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        flush(&mut out, &mut text, heading);
                        heading = None;
                    }
                    "p" | "li" | "blockquote" | "dd" | "dt" | "pre" | "div" | "section" | "tr" => {
                        flush(&mut out, &mut text, heading);
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) if local_name(e.name().as_ref()).eq_ignore_ascii_case("br") => {
                text.push(' ')
            }
            // Entities arrive separately (GeneralRef), so text is used as is.
            Ok(Event::Text(t)) if skip_depth == 0 => text.push_str(&t),
            Ok(Event::CData(t)) if skip_depth == 0 => text.push_str(&t),
            Ok(Event::GeneralRef(r)) if skip_depth == 0 => {
                text.push_str(&unescape(&format!("&{};", &*r)))
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    flush(&mut out, &mut text, heading);
    out
}

/// XML's five entities, numeric references and a few common HTML ones.
fn unescape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let Some(end) = tail.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "lsquo" => Some('‘'),
            "rsquo" => Some('’'),
            "ldquo" => Some('“'),
            "rdquo" => Some('”'),
            "hellip" => Some('…'),
            e if e.starts_with("#x") || e.starts_with("#X") => u32::from_str_radix(&e[2..], 16)
                .ok()
                .and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => out.push(c),
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_follow_headings_and_skip_scripts() {
        let found = blocks(
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
}
