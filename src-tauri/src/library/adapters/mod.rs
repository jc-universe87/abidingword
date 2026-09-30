//! Source import adapters: one per format, one normalised result.
//!
//! Each adapter turns a file's bytes into an [`ImportedDocument`]: metadata
//! it can find, and ordered segments carrying only the provenance the format
//! really has (PDF pages; EPUB chapters and sections; Markdown headings).
//! Adapters never execute content and never guess page numbers.
//!
//! Later formats (DOCX, HTML, OCR'd scans, transcripts) are further
//! adapters producing the same result.

pub mod epub;
pub mod markdown;
pub mod pdf;
pub mod text;

use crate::error::AppResult;

/// Where an extracted text layer came from (`source_files.extraction_status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtractionStatus {
    /// Born-digital text (EPUB, Markdown, plain text).
    DigitalText,
    /// Text pulled out of a layout format (PDF).
    ExtractedText,
    /// No usable text layer: needs OCR (not available in v0.4).
    OcrRequired,
}

impl ExtractionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DigitalText => "digital_text",
            Self::ExtractedText => "extracted_text",
            Self::OcrRequired => "ocr_required",
        }
    }
}

/// Metadata an adapter could read from the file itself.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FoundMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub isbn: Option<String>,
    pub identifier: Option<String>,
}

/// One piece of text with its location in the original.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NewSegment {
    pub text: String,
    pub page_number: Option<u32>,
    pub page_label: Option<String>,
    pub chapter: Option<String>,
    pub heading: Option<String>,
    /// e.g. "Chapter 3 › The Cross".
    pub section_path: Option<String>,
    pub paragraph_index: Option<u32>,
    pub char_start: Option<u32>,
    pub char_end: Option<u32>,
}

impl NewSegment {
    /// A short human-readable location: "p. 152", "Chapter 3 › Grace",
    /// "Introduction", or "¶ 4".
    pub fn locator(&self) -> String {
        if let Some(label) = &self.page_label {
            return format!("p. {label}");
        }
        if let Some(page) = self.page_number {
            return format!("p. {page}");
        }
        if let Some(path) = self.section_path.as_ref().filter(|p| !p.is_empty()) {
            return path.clone();
        }
        if let Some(chapter) = &self.chapter {
            return chapter.clone();
        }
        match self.paragraph_index {
            Some(i) => format!("¶ {}", i + 1),
            None => String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedDocument {
    /// "pdf", "epub", "markdown", "text".
    pub format: &'static str,
    pub metadata: FoundMetadata,
    pub segments: Vec<NewSegment>,
    pub extraction_status: ExtractionStatus,
    pub page_count: Option<u32>,
    /// Chapters (EPUB) or top-level headings (Markdown).
    pub chapter_count: Option<u32>,
}

pub trait SourceImportAdapter {
    fn format(&self) -> &'static str;
    /// Whether this adapter reads a file with this (lower-case) extension.
    fn accepts(&self, extension: &str) -> bool;
    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument>;
}

pub fn adapters() -> [&'static dyn SourceImportAdapter; 4] {
    [
        &pdf::PdfImporter,
        &epub::EpubImporter,
        &markdown::MarkdownImporter,
        &text::TextImporter,
    ]
}

// --- shared text helpers ----------------------------------------------------

/// Collapses runs of whitespace to single spaces.
pub fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Splits running text into paragraphs at blank lines, joining the lines of
/// each paragraph (and words hyphenated across a line break). Returns
/// (paragraph, start, end) with byte offsets into `text`.
pub fn paragraphs(text: &str) -> Vec<(String, usize, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut end = 0;
    let mut offset = 0;
    let flush = |out: &mut Vec<(String, usize, usize)>, s: usize, e: usize| {
        let joined = join_lines(&text[s..e]);
        if !joined.is_empty() {
            out.push((joined, s, e));
        }
    };
    for line in text.split_inclusive('\n') {
        if line.trim().is_empty() {
            if let Some(s) = start.take() {
                flush(&mut out, s, end);
            }
        } else {
            start.get_or_insert(offset);
            end = offset + line.trim_end().len();
        }
        offset += line.len();
    }
    if let Some(s) = start {
        flush(&mut out, s, end);
    }
    out
}

fn join_lines(block: &str) -> String {
    let mut joined = String::new();
    for line in block.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if joined.ends_with('-') && line.chars().next().is_some_and(char::is_lowercase) {
            joined.pop();
            joined.push_str(line);
        } else {
            if !joined.is_empty() {
                joined.push(' ');
            }
            joined.push_str(line);
        }
    }
    collapse(&joined)
}

/// Very long paragraphs are split at sentence ends near `max` characters,
/// so a search hit points at a readable passage, not a whole chapter.
pub fn split_long(paragraph: &str, max: usize) -> Vec<String> {
    if paragraph.chars().count() <= max {
        return vec![paragraph.to_string()];
    }
    let mut parts = Vec::new();
    let mut current = String::new();
    for sentence in paragraph.split_inclusive(['.', '!', '?']) {
        if current.chars().count() + sentence.chars().count() > max && !current.trim().is_empty() {
            parts.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(sentence);
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraphs_join_lines_and_hyphenation() {
        let text = "The cross is the centre\nof the gos-\npel.\n\n  Second paragraph.\n";
        let found = paragraphs(text);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].0, "The cross is the centre of the gospel.");
        assert_eq!(found[1].0, "Second paragraph.");
        assert_eq!(&text[found[1].1..found[1].2], "  Second paragraph.");
    }

    #[test]
    fn long_paragraphs_split_at_sentences() {
        let parts = split_long("One two. Three four. Five six.", 12);
        assert_eq!(parts, ["One two.", "Three four.", "Five six."]);
    }

    #[test]
    fn locators_prefer_the_real_provenance() {
        let page = NewSegment {
            page_number: Some(152),
            ..Default::default()
        };
        assert_eq!(page.locator(), "p. 152");
        let section = NewSegment {
            chapter: Some("Chapter 3".into()),
            section_path: Some("Chapter 3 › Grace".into()),
            ..Default::default()
        };
        assert_eq!(section.locator(), "Chapter 3 › Grace");
        let plain = NewSegment {
            paragraph_index: Some(3),
            ..Default::default()
        };
        assert_eq!(plain.locator(), "¶ 4");
    }
}
