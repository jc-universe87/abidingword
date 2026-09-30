//! Plain text (.txt): paragraphs separated by blank lines. No heading
//! guessing.

use super::{
    paragraphs, split_long, ExtractionStatus, FoundMetadata, ImportedDocument, NewSegment,
    SourceImportAdapter,
};
use crate::error::{AppError, AppResult};

pub struct TextImporter;

const MAX_SEGMENT: usize = 1_500;

impl SourceImportAdapter for TextImporter {
    fn format(&self) -> &'static str {
        "text"
    }

    fn accepts(&self, extension: &str) -> bool {
        extension == "txt"
    }

    fn extract(&self, bytes: &[u8], file_name: &str) -> AppResult<ImportedDocument> {
        let text = decode_utf8(bytes, file_name)?;
        let mut segments = Vec::new();
        for (paragraph, start, end) in paragraphs(&text) {
            for part in split_long(&paragraph, MAX_SEGMENT) {
                segments.push(NewSegment {
                    text: part,
                    paragraph_index: Some(segments.len() as u32),
                    char_start: Some(start as u32),
                    char_end: Some(end as u32),
                    ..Default::default()
                });
            }
        }
        Ok(ImportedDocument {
            format: "text",
            metadata: FoundMetadata::default(),
            segments,
            extraction_status: ExtractionStatus::DigitalText,
            page_count: None,
            chapter_count: None,
        })
    }
}

/// UTF-8 text, with a byte-order mark tolerated.
pub(crate) fn decode_utf8(bytes: &[u8], file_name: &str) -> AppResult<String> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        AppError::Import(format!(
            "“{file_name}” is not saved as UTF-8 text, so it could not be read."
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_into_paragraphs_in_order() {
        let doc = TextImporter
            .extract(
                b"First thought.\n\nSecond\nthought.\n\n\nThird.",
                "notes.txt",
            )
            .unwrap();
        let texts: Vec<_> = doc.segments.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["First thought.", "Second thought.", "Third."]);
        assert_eq!(doc.segments[2].paragraph_index, Some(2));
        assert!(doc.segments.iter().all(|s| s.page_number.is_none()));
    }

    #[test]
    fn rejects_non_utf8() {
        assert!(TextImporter.extract(&[0xff, 0xfe, 0x41], "x.txt").is_err());
    }
}
