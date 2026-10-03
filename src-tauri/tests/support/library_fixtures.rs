//! Test-only generators for library fixtures. Everything is synthetic text
//! written by these functions; no third-party material is used.

#![allow(dead_code)]

use std::io::Write;

use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, Stream};

/// A PDF whose pages hold the given paragraphs (each paragraph one line,
/// paragraphs separated by a wide gap). `title`/`author` go in the Info
/// dictionary. A page with no paragraphs has no text at all (like a scan).
pub fn pdf(pages: &[&[&str]], title: Option<&str>, author: Option<&str>) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
    });
    let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
    let mut kids = Vec::new();
    for paragraphs in pages {
        let mut operations = Vec::new();
        let mut y = 750;
        for paragraph in paragraphs.iter() {
            operations.extend([
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 11.into()]),
                Operation::new("Td", vec![72.into(), y.into()]),
                Operation::new("Tj", vec![Object::string_literal(*paragraph)]),
                Operation::new("ET", vec![]),
            ]);
            y -= 60;
        }
        let content = Content { operations };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        kids.push(Object::Reference(page_id));
    }
    let count = kids.len() as i64;
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => count, "Resources" => resources_id,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    let mut info = lopdf::Dictionary::new();
    if let Some(t) = title {
        info.set("Title", Object::string_literal(t));
    }
    if let Some(a) = author {
        info.set("Author", Object::string_literal(a));
    }
    if !info.is_empty() {
        let info_id = doc.add_object(info);
        doc.trailer.set("Info", info_id);
    }
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

/// An EPUB 3 with the given chapters, listed in `spine_order` (indexes into
/// `chapters`), so reading order can differ from manifest order.
pub struct EpubChapter<'a> {
    pub file: &'a str,
    pub xhtml_body: &'a str,
}

pub fn epub(opf_metadata: &str, chapters: &[EpubChapter], spine_order: &[usize]) -> Vec<u8> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default();
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        let manifest: String = chapters
            .iter()
            .enumerate()
            .map(|(i, c)| {
                format!(
                    r#"<item id="c{i}" href="{}" media-type="application/xhtml+xml"/>"#,
                    c.file
                )
            })
            .collect();
        let spine: String = spine_order
            .iter()
            .map(|i| format!(r#"<itemref idref="c{i}"/>"#))
            .collect();
        let opf = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{opf_metadata}</metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>"#
        );
        zip.start_file("OEBPS/content.opf", deflated).unwrap();
        zip.write_all(opf.as_bytes()).unwrap();
        for chapter in chapters {
            zip.start_file(format!("OEBPS/{}", chapter.file), deflated)
                .unwrap();
            let xhtml = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>{}</body></html>"#,
                chapter.xhtml_body
            );
            zip.write_all(xhtml.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }
    cursor.into_inner()
}

/// An EPUB built from raw parts, for table-of-contents tests: `files` are
/// (path inside the archive, content) pairs written as given; `manifest` and
/// `spine` are the raw inner XML of those package elements.
pub fn epub_raw(manifest: &str, spine_attrs: &str, spine: &str, files: &[(&str, &str)]) -> Vec<u8> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default();
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        let opf = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Synthetic Contents</dc:title><dc:language>en</dc:language></metadata><manifest>{manifest}</manifest><spine {spine_attrs}>{spine}</spine></package>"#
        );
        zip.start_file("OEBPS/content.opf", deflated).unwrap();
        zip.write_all(opf.as_bytes()).unwrap();
        for (path, content) in files {
            zip.start_file(*path, deflated).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }
    cursor.into_inner()
}

/// One XHTML chapter document.
pub fn xhtml(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>{body}</body></html>"#
    )
}
