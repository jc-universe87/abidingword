//! Bible documents (v0.23): PDF, EPUB, Word (.docx), Markdown and plain-text
//! files added as Bibles.
//!
//! The file is read by the **library's own adapters** (`library::adapters`):
//! the same text extraction, page locations, chapter structure and safety
//! limits the Sources library uses. Nothing here parses a PDF, EPUB or DOCX
//! itself. What this module adds is the Bible's view of that text:
//!
//! * the **segments** kept for reading and searching the document as it is
//!   (paragraphs with their page or section, as the library keeps them);
//! * the **units** the verse recogniser reads (`scripture::structure`): the
//!   lines of a PDF page or text file, or the paragraphs and headings of an
//!   EPUB, DOCX or Markdown file, each with the segment it lies in, so every
//!   verse found can be traced back to its place in the original.
//!
//! A PDF without a text layer (scanned pages) is kept with no segments and
//! no units: it can be read page by page in the original, never searched or
//! divided into verses. No OCR is done and nothing leaves the computer.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult, UserMessage};
use crate::library::adapters::{
    docx::DocxImporter, epub::EpubImporter, markdown::MarkdownImporter, pdf, text::TextImporter,
    ExtractionStatus, FoundMetadata, NewSegment, SourceImportAdapter,
};
use crate::library::files::content_hash;

/// Largest document accepted (as the library: a long PDF Bible is well under this).
pub const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// All the documents of one Bible together.
pub const MAX_TOTAL_BYTES: u64 = 400 * 1024 * 1024;
/// More documents than this are not one edition.
pub const MAX_FILES: usize = 100;

/// The file extensions read as Bible documents.
pub fn is_document_extension(extension: &str) -> bool {
    matches!(
        extension,
        "pdf" | "epub" | "docx" | "md" | "markdown" | "txt"
    )
}

/// Whether a Bible's source format is a document (v0.23).
pub fn is_document_format(format: &str) -> bool {
    matches!(format, "pdf" | "epub" | "docx" | "markdown" | "text")
}

/// One piece of text the verse recogniser reads, with where it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    pub text: String,
    /// A heading of the document's own structure (EPUB, DOCX, Markdown).
    /// PDF and plain-text lines never are: their headings are recognised
    /// by what they say, not by how they look.
    pub heading: bool,
    pub place: Place,
}

/// Where a unit is in the original document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    /// Which of the Bible's documents (0 = the first).
    pub document: u16,
    /// The page (PDF), 1 = the first.
    pub page: Option<u32>,
    /// The kept segment the unit lies in (its position in the document).
    pub segment: Option<u32>,
}

/// A document read and ready to be kept.
#[derive(Debug)]
pub struct DocumentFile {
    /// The file as chosen (copied on commit).
    pub path: PathBuf,
    pub file_name: String,
    /// "pdf", "epub", "docx", "markdown" or "text".
    pub format: &'static str,
    pub extension: String,
    pub size: u64,
    pub hash: String,
    pub metadata: FoundMetadata,
    pub extraction_status: ExtractionStatus,
    pub page_count: Option<u32>,
    pub segments: Vec<NewSegment>,
    pub units: Vec<Unit>,
    /// Footnotes and endnotes kept apart from the body (DOCX).
    pub notes: usize,
}

impl DocumentFile {
    /// Characters of readable text.
    pub fn text_chars(&self) -> usize {
        self.segments.iter().map(|s| s.text.chars().count()).sum()
    }

    /// Whether the original is shown as it is laid out (PDF pages, the
    /// EPUB's and DOCX's formatting); Markdown and plain text are shown as
    /// their text.
    pub fn keeps_layout(&self) -> bool {
        matches!(self.format, "pdf" | "epub" | "docx")
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into())
}

fn extension(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Reads one document. `document` is its place among the Bible's documents.
pub fn read(path: &Path, document: u16) -> AppResult<DocumentFile> {
    let name = file_name(path);
    let extension = extension(path);
    let size = fs::metadata(path)
        .map_err(|e| AppError::filesystem(path, e))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(AppError::Import(
            UserMessage::new(
                "library.tooLarge",
                format!("“{name}” is too large to import."),
            )
            .with("fileName", &name),
        ));
    }
    let bytes = fs::read(path).map_err(|e| AppError::filesystem(path, e))?;
    read_bytes(path, &name, &extension, &bytes, size, document)
}

/// Reads a document already in memory (tests read fixtures this way).
pub fn read_bytes(
    path: &Path,
    name: &str,
    extension: &str,
    bytes: &[u8],
    size: u64,
    document: u16,
) -> AppResult<DocumentFile> {
    let hash = content_hash(bytes);
    let mut file = match extension {
        "pdf" => {
            let text = pdf::read_pages(bytes, name)?;
            let page_count = Some(text.pages.len() as u32);
            if text.scanned {
                DocumentFile {
                    path: path.to_path_buf(),
                    file_name: name.into(),
                    format: "pdf",
                    extension: extension.into(),
                    size,
                    hash,
                    metadata: text.metadata,
                    extraction_status: ExtractionStatus::OcrRequired,
                    page_count,
                    segments: Vec::new(),
                    units: Vec::new(),
                    notes: 0,
                }
            } else {
                let segments = pdf::page_segments(&text.pages);
                let mut units = Vec::new();
                for (index, page) in text.pages.iter().enumerate() {
                    let number = index as u32 + 1;
                    line_units(page, Some(number), &segments, document, &mut units);
                }
                DocumentFile {
                    path: path.to_path_buf(),
                    file_name: name.into(),
                    format: "pdf",
                    extension: extension.into(),
                    size,
                    hash,
                    metadata: text.metadata,
                    extraction_status: ExtractionStatus::ExtractedText,
                    page_count,
                    segments,
                    units,
                    notes: 0,
                }
            }
        }
        "txt" => {
            let doc = TextImporter.extract(bytes, name)?;
            let text = crate::library::adapters::text::decode_utf8(bytes, name)?;
            let mut units = Vec::new();
            line_units(&text, None, &doc.segments, document, &mut units);
            DocumentFile {
                path: path.to_path_buf(),
                file_name: name.into(),
                format: doc.format,
                extension: extension.into(),
                size,
                hash,
                metadata: doc.metadata,
                extraction_status: doc.extraction_status,
                page_count: None,
                segments: doc.segments,
                units,
                notes: 0,
            }
        }
        "epub" | "docx" | "md" | "markdown" => {
            let adapter: &dyn SourceImportAdapter = match extension {
                "epub" => &EpubImporter,
                "docx" => &DocxImporter,
                _ => &MarkdownImporter,
            };
            let doc = adapter.extract(bytes, name)?;
            let (units, notes) = structured_units(&doc.segments, document);
            DocumentFile {
                path: path.to_path_buf(),
                file_name: name.into(),
                format: doc.format,
                extension: extension.into(),
                size,
                hash,
                metadata: doc.metadata,
                extraction_status: doc.extraction_status,
                page_count: doc.page_count,
                segments: doc.segments,
                units,
                notes,
            }
        }
        _ => {
            return Err(AppError::UnsupportedFormat(
                UserMessage::new(
                    "bibleImport.documentFormat",
                    format!("“{name}” is not a kind of document Abiding Word can read as a Bible."),
                )
                .with("fileName", name),
            ))
        }
    };
    if file.segments.is_empty() && file.extraction_status != ExtractionStatus::OcrRequired {
        // Nothing to read at all (an empty text file, an EPUB without text).
        return Err(AppError::Import(
            UserMessage::new(
                "bibleImport.documentEmpty",
                format!("No text was found in “{name}”."),
            )
            .with("fileName", name),
        ));
    }
    file.units.retain(|u| !u.text.trim().is_empty());
    Ok(file)
}

/// The lines of a page (PDF) or a whole text file, each with the segment
/// whose paragraph it belongs to. `segments` carry byte offsets into the
/// same text (`char_start`/`char_end`, as the library's adapters record).
fn line_units(
    text: &str,
    page: Option<u32>,
    segments: &[NewSegment],
    document: u16,
    out: &mut Vec<Unit>,
) {
    // The segments of this page (or the file), by where their paragraph starts.
    let ranges: Vec<(u32, u32, u32)> = segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.page_number == page)
        .filter_map(|(i, s)| Some((s.char_start?, s.char_end?, i as u32)))
        .collect();
    let mut offset = 0u32;
    for line in text.split_inclusive('\n') {
        let start = offset;
        offset += line.len() as u32;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let segment = ranges
            .iter()
            .find(|(s, e, _)| start + 1 > *s && start < *e + 1)
            .or_else(|| ranges.iter().find(|(s, _, _)| *s >= start))
            .map(|(_, _, i)| *i);
        out.push(Unit {
            text: trimmed.to_string(),
            heading: false,
            place: Place {
                document,
                page,
                segment,
            },
        });
    }
}

/// The paragraphs of an EPUB, DOCX or Markdown document, with its headings
/// put back between them: the adapters keep headings as each paragraph's
/// section path ("Genesis › Chapter 1"), so a heading starts wherever that
/// path changes. Footnotes and endnotes (DOCX) are left out and counted.
fn structured_units(segments: &[NewSegment], document: u16) -> (Vec<Unit>, usize) {
    let mut out = Vec::new();
    let mut notes = 0usize;
    let mut previous: Vec<&str> = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if segment.note {
            notes += 1;
            continue;
        }
        let place = Place {
            document,
            page: segment.page_number,
            segment: Some(index as u32),
        };
        let path: Vec<&str> = segment
            .section_path
            .as_deref()
            .map(|p| p.split(" › ").collect())
            .unwrap_or_default();
        // The first level where the path differs: every heading from there on
        // was passed since the paragraph before.
        let same = previous
            .iter()
            .zip(path.iter())
            .take_while(|(a, b)| a == b)
            .count();
        let changed = same < path.len() || path.len() < previous.len();
        if changed {
            for heading in &path[same..] {
                out.push(Unit {
                    text: (*heading).to_string(),
                    heading: true,
                    place,
                });
            }
        }
        previous = path;
        out.push(Unit {
            text: segment.text.clone(),
            heading: false,
            place,
        });
    }
    (out, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_named(name: &str, bytes: &[u8]) -> DocumentFile {
        let extension = name.rsplit('.').next().unwrap();
        read_bytes(
            Path::new(name),
            name,
            extension,
            bytes,
            bytes.len() as u64,
            0,
        )
        .unwrap()
    }

    #[test]
    fn text_lines_keep_their_paragraph() {
        let file = read_named(
            "bible.txt",
            "Genesis\n\nChapter 1\n\n1 In the beginning.\n2 And the earth\nwas without form.\n"
                .as_bytes(),
        );
        let texts: Vec<&str> = file.units.iter().map(|u| u.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "Genesis",
                "Chapter 1",
                "1 In the beginning.",
                "2 And the earth",
                "was without form."
            ]
        );
        // Lines of the same paragraph point at the same kept segment.
        assert_eq!(file.units[3].place.segment, file.units[4].place.segment);
        assert_eq!(file.units[0].place.segment, Some(0));
        assert_eq!(file.units[2].place.segment, Some(2));
        assert!(file.units.iter().all(|u| !u.heading));
    }

    #[test]
    fn markdown_headings_come_back_between_paragraphs() {
        let file = read_named(
            "bible.md",
            "# Genesis\n\n## Chapter 1\n\n1 In the beginning.\n\n## Chapter 2\n\n1 Thus the heavens.\n"
                .as_bytes(),
        );
        let got: Vec<(&str, bool)> = file
            .units
            .iter()
            .map(|u| (u.text.as_str(), u.heading))
            .collect();
        assert_eq!(
            got,
            [
                ("Genesis", true),
                ("Chapter 1", true),
                ("1 In the beginning.", false),
                ("Chapter 2", true),
                ("1 Thus the heavens.", false),
            ]
        );
    }

    #[test]
    fn an_empty_text_file_is_refused() {
        let error = read_bytes(Path::new("x.txt"), "x.txt", "txt", b"\n\n", 2, 0).unwrap_err();
        assert!(format!("{error:?}").contains("documentEmpty"));
    }

    #[test]
    fn other_files_are_refused() {
        assert!(read_bytes(Path::new("x.rtf"), "x.rtf", "rtf", b"{\\rtf1}", 7, 0).is_err());
    }
}
