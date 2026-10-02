//! PDF: the text layer, page by page. Page numbers are the physical page
//! order (1 = first page). No OCR: a PDF without a usable text layer is
//! reported as needing OCR, never "imported" empty.

use std::panic::{catch_unwind, AssertUnwindSafe};

use lopdf::{decode_text_string, Document, Object};

use super::{
    paragraphs, split_long, ExtractionStatus, FoundMetadata, ImportedDocument, NewSegment,
    SourceImportAdapter,
};
use crate::error::{AppError, AppResult, UserMessage};

pub struct PdfImporter;

const MAX_SEGMENT: usize = 1_500;
/// Below this many letters per page on average, the PDF is treated as
/// scanned images without a text layer.
const MIN_LETTERS_PER_PAGE: usize = 25;

impl SourceImportAdapter for PdfImporter {
    fn format(&self) -> &'static str {
        "pdf"
    }

    fn accepts(&self, extension: &str) -> bool {
        extension == "pdf"
    }

    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument> {
        let unreadable = || {
            AppError::Import(
                UserMessage::new(
                    "library.badPdf",
                    format!("“{file_name}” could not be read as a PDF."),
                )
                .with("fileName", file_name),
            )
        };
        let document = Document::load_mem(bytes).map_err(|_| unreadable())?;
        if document.is_encrypted() {
            return Err(AppError::Import(
                UserMessage::new(
                    "library.passwordProtected",
                    format!(
                        "“{file_name}” is password-protected. Remove the protection and import it again."
                    ),
                )
                .with("fileName", file_name),
            ));
        }
        let metadata = metadata(&document);
        // The text extractor can panic on unusual files; that must never
        // take the app down.
        let pages = catch_unwind(AssertUnwindSafe(|| {
            pdf_extract::extract_text_from_mem_by_pages(bytes)
        }))
        .map_err(|_| unreadable())?
        .map_err(|e| {
            log::warn!("pdf text extraction failed for {file_name}: {e}");
            unreadable()
        })?;

        let page_count = pages.len() as u32;
        let letters: usize = pages
            .iter()
            .map(|p| p.chars().filter(|c| c.is_alphanumeric()).count())
            .sum();
        if pages.is_empty() || letters < MIN_LETTERS_PER_PAGE * pages.len() {
            return Ok(ImportedDocument {
                format: "pdf",
                metadata,
                segments: Vec::new(),
                extraction_status: ExtractionStatus::OcrRequired,
                page_count: Some(page_count),
                chapter_count: None,
            });
        }

        let mut segments = Vec::new();
        for (index, page) in pages.iter().enumerate() {
            let number = index as u32 + 1;
            let mut paragraph = 0u32;
            for (text, start, end) in paragraphs(page) {
                for part in split_long(&text, MAX_SEGMENT) {
                    segments.push(NewSegment {
                        text: part,
                        page_number: Some(number),
                        paragraph_index: Some(paragraph),
                        char_start: Some(start as u32),
                        char_end: Some(end as u32),
                        ..Default::default()
                    });
                    paragraph += 1;
                }
            }
        }
        Ok(ImportedDocument {
            format: "pdf",
            metadata,
            segments,
            extraction_status: ExtractionStatus::ExtractedText,
            page_count: Some(page_count),
            chapter_count: None,
        })
    }
}

fn metadata(document: &Document) -> FoundMetadata {
    let info = document
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|info| match info {
            Object::Reference(id) => document.get_dictionary(*id).ok(),
            Object::Dictionary(d) => Some(d),
            _ => None,
        });
    let field = |key: &[u8]| -> Option<String> {
        info.and_then(|d| d.get(key).ok())
            .and_then(|v| decode_text_string(v).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let language = document
        .catalog()
        .ok()
        .and_then(|c| c.get(b"Lang").ok())
        .and_then(|v| decode_text_string(v).ok())
        .filter(|s| !s.is_empty());
    FoundMetadata {
        title: field(b"Title"),
        author: field(b"Author"),
        language,
        ..Default::default()
    }
}
