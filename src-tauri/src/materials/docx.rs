//! A teaching material as a Word document (v0.18.8).
//!
//! The interface puts a material together once from the person's teaching
//! (`src/features/materials/derive.ts`); the preview, the printed page, the
//! Markdown, the copied text and this Word document all draw that one
//! document, block by block, so they can never say different things. This
//! writer adds nothing and leaves nothing out: every block becomes real
//! paragraphs with named styles (Title, Heading 1, a question, a passage of
//! Scripture…), so the file is an ordinary, editable document. Question
//! numbers are written as the material gives them, never renumbered.
//!
//! The package is the smallest one Word and LibreOffice open without
//! complaint: content types, relationships, the document, its styles and
//! its core properties. It is written with fixed dates, so the same material
//! gives the same file.

use std::io::{Cursor, Write};

use serde::Deserialize;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialDocument {
    /// manuscript, questions or worksheet.
    pub kind: String,
    pub title: String,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Verse {
    pub number: String,
    pub text: String,
}

/// The blocks of the material model (`Block` in derive.ts).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    Title {
        text: String,
    },
    Passages {
        text: String,
    },
    Scripture {
        label: String,
        verses: Vec<Verse>,
        #[serde(default)]
        note: Option<String>,
        #[serde(default)]
        attribution: Option<String>,
    },
    Notice {
        text: String,
    },
    Message {
        label: String,
        text: String,
    },
    Heading {
        text: String,
        #[serde(default)]
        detail: Option<String>,
    },
    Text {
        text: String,
    },
    Field {
        label: String,
        text: String,
    },
    Question {
        number: u32,
        text: String,
    },
    Space {
        /// "lines" or "box".
        style: String,
        #[serde(default)]
        label: Option<String>,
    },
}

/// Text as XML character data: escaped, and without the control characters
/// XML cannot hold (a tab and a line break are kept, as Word's own).
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\t' | '\n' => out.push(c),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

/// Runs of one piece of text, with its own line breaks and tabs kept.
fn runs(text: &str, props: &str) -> String {
    let rpr = if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{props}</w:rPr>")
    };
    let mut out = String::new();
    for (i, line) in text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .enumerate()
    {
        if i > 0 {
            out.push_str(&format!("<w:r>{rpr}<w:br/></w:r>"));
        }
        for (j, part) in line.split('\t').enumerate() {
            if j > 0 {
                out.push_str(&format!("<w:r>{rpr}<w:tab/></w:r>"));
            }
            if !part.is_empty() {
                out.push_str(&format!(
                    "<w:r>{rpr}<w:t xml:space=\"preserve\">{}</w:t></w:r>",
                    escape(part)
                ));
            }
        }
    }
    out
}

fn paragraph(style: &str, content: &str) -> String {
    format!("<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>{content}</w:p>")
}

/// The body of the document: each block in order, as the material has it.
fn body(doc: &MaterialDocument) -> String {
    let mut out = String::new();
    for block in &doc.blocks {
        match block {
            Block::Title { text } => out.push_str(&paragraph("Title", &runs(text, ""))),
            Block::Passages { text } => out.push_str(&paragraph("AwReference", &runs(text, ""))),
            Block::Notice { text } => out.push_str(&paragraph("AwNotice", &runs(text, ""))),
            Block::Message { label, text } => {
                out.push_str(&paragraph("AwLabel", &runs(label, "")));
                out.push_str(&paragraph("AwMessage", &runs(text, "")));
            }
            Block::Heading { text, detail } => {
                let mut content = runs(text, "");
                if let Some(detail) = detail.as_deref().filter(|d| !d.trim().is_empty()) {
                    content.push_str(&runs(&format!(" · {detail}"), "<w:b w:val=\"0\"/>"));
                }
                out.push_str(&paragraph("Heading1", &content));
            }
            Block::Text { text } => out.push_str(&paragraph("Normal", &runs(text, ""))),
            Block::Field { label, text } => {
                out.push_str(&paragraph("AwLabel", &runs(label, "")));
                out.push_str(&paragraph("Normal", &runs(text, "")));
            }
            Block::Question { number, text } => {
                // The material's own number, as on every other sheet: never Word's list numbering.
                let content = format!(
                    "{}{}",
                    runs(&format!("{number}.\t"), "<w:b/>"),
                    runs(text, "")
                );
                out.push_str(&paragraph("AwQuestion", &content));
            }
            Block::Scripture {
                label,
                verses,
                note,
                attribution,
            } => {
                out.push_str(&paragraph("AwLabel", &runs(label, "")));
                let mut content = String::new();
                for (i, verse) in verses.iter().enumerate() {
                    content.push_str(&runs(&verse.number, "<w:vertAlign w:val=\"superscript\"/>"));
                    let words = if i + 1 < verses.len() {
                        format!("\u{00A0}{} ", verse.text)
                    } else {
                        format!("\u{00A0}{}", verse.text)
                    };
                    content.push_str(&runs(&words, ""));
                }
                if !content.is_empty() {
                    out.push_str(&paragraph("AwScripture", &content));
                }
                if let Some(note) = note.as_deref().filter(|n| !n.trim().is_empty()) {
                    out.push_str(&paragraph("AwNote", &runs(note, "<w:i/>")));
                }
                if let Some(a) = attribution.as_deref().filter(|n| !n.trim().is_empty()) {
                    out.push_str(&paragraph("AwNote", &runs(a, "")));
                }
            }
            Block::Space { style, label } => {
                if let Some(label) = label.as_deref().filter(|l| !l.trim().is_empty()) {
                    out.push_str(&paragraph("AwLabel", &runs(label, "")));
                }
                if style == "box" {
                    // Room to draw: one empty framed cell, kept on one page.
                    out.push_str(BOX);
                } else {
                    // Room to write: a few ruled lines, which stay editable.
                    for _ in 0..3 {
                        out.push_str(&paragraph("AwLine", ""));
                    }
                }
            }
        }
    }
    out
}

const BOX: &str = r#"<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="B9BCBA"/><w:left w:val="single" w:sz="6" w:space="0" w:color="B9BCBA"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="B9BCBA"/><w:right w:val="single" w:sz="6" w:space="0" w:color="B9BCBA"/></w:tblBorders><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="2600" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="pct"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p/>"#;

const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

fn document_xml(doc: &MaterialDocument) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document {NS}><w:body>{}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1418\" w:right=\"1418\" w:bottom=\"1418\" w:left=\"1418\" w:header=\"709\" w:footer=\"709\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>",
        body(doc)
    )
}

/// Restrained styles with real names, so headings show in Word's navigation
/// and the person can restyle the whole document at once.
const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Malgun Gothic" w:cs="Georgia"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="en-GB" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwReference"><w:name w:val="Bible reference"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="55585A"/><w:sz w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwNotice"><w:name w:val="Notice"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="762E32"/></w:pBdr><w:ind w:left="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/><w:sz w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwLabel"><w:name w:val="Label"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="40"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/><w:caps/><w:color w:val="55585A"/><w:sz w:val="17"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwMessage"><w:name w:val="Message"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B48135"/></w:pBdr><w:ind w:left="200"/></w:pPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwQuestion"><w:name w:val="Question"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:tabs><w:tab w:val="left" w:pos="420"/></w:tabs><w:spacing w:before="240"/><w:ind w:left="420" w:hanging="420"/></w:pPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwScripture"><w:name w:val="Scripture"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="8" w:space="8" w:color="B9BCBA"/></w:pBdr><w:ind w:left="200"/></w:pPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwNote"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="55585A"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="AwLine"><w:name w:val="Writing line"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="B9BCBA"/></w:pBdr><w:spacing w:before="200" w:after="0"/></w:pPr></w:style></w:styles>"#;

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#;

const RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#;

const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;

fn core_xml(title: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>{}</dc:title><dc:creator>Abiding Word</dc:creator></cp:coreProperties>",
        escape(title)
    )
}

/// The material as the bytes of a .docx file.
pub fn render(doc: &MaterialDocument) -> AppResult<Vec<u8>> {
    let files: [(&str, String); 6] = [
        ("[Content_Types].xml", CONTENT_TYPES.to_string()),
        ("_rels/.rels", RELS.to_string()),
        ("docProps/core.xml", core_xml(&doc.title)),
        ("word/_rels/document.xml.rels", DOCUMENT_RELS.to_string()),
        ("word/document.xml", document_xml(doc)),
        ("word/styles.xml", STYLES.to_string()),
    ];
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let fail = |e: &dyn std::fmt::Display| AppError::Unexpected(format!("Word document: {e}"));
    for (path, data) in files {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(zip::DateTime::default());
        writer.start_file(path, options).map_err(|e| fail(&e))?;
        writer.write_all(data.as_bytes()).map_err(|e| fail(&e))?;
    }
    Ok(writer.finish().map_err(|e| fail(&e))?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_escaped_and_control_characters_dropped() {
        assert_eq!(
            escape("a < b & \"c\" > d\u{0007}"),
            "a &lt; b &amp; &quot;c&quot; &gt; d"
        );
        assert_eq!(runs("one\ntwo", ""), "<w:r><w:t xml:space=\"preserve\">one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space=\"preserve\">two</w:t></w:r>");
    }
}
