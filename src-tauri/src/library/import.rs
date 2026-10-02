//! Library import: choose file → detect type → extract metadata and text →
//! normalise → detect Bible references → validate → preview → confirm →
//! copy managed file → persist → index (search triggers).
//!
//! [`stage`] does everything up to the preview; nothing is written until
//! `db::library::commit_import` runs in one transaction.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult, UserMessage};
use crate::library::adapters::{adapters, ExtractionStatus, ImportedDocument};
use crate::library::files::content_hash;
use crate::scripture::parser::{DetectedReference, ReferenceParser};

/// Largest file accepted (a long PDF book is well under this).
const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;

pub struct StagedSource {
    pub id: String,
    pub path: PathBuf,
    pub file_name: String,
    pub extension: String,
    pub size: u64,
    pub hash: String,
    pub document: ImportedDocument,
    /// Bible references found, by segment index.
    pub references: Vec<(usize, DetectedReference)>,
}

impl StagedSource {
    /// Why this file cannot be added, in plain words; None when it can.
    pub fn problem(&self) -> Option<UserMessage> {
        if self.document.extraction_status == ExtractionStatus::OcrRequired {
            return Some(UserMessage::new(
                "library.scannedPdf",
                "This PDF appears to contain scanned pages. OCR support is not available yet, \
                 so its text cannot be added.",
            ));
        }
        if self.document.segments.is_empty() {
            return Some(UserMessage::new(
                "library.noText",
                "No text was found in this file.",
            ));
        }
        None
    }
}

pub fn stage(path: &Path) -> AppResult<StagedSource> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let adapter = adapters()
        .into_iter()
        .find(|a| a.accepts(&extension))
        .ok_or_else(|| {
            AppError::UnsupportedFormat(
                UserMessage::new(
                    "library.unsupportedFile",
                    format!(
                        "“{file_name}” is not a kind of file the library can read yet. \
                         It reads PDF, EPUB, Markdown (.md) and plain text (.txt) files."
                    ),
                )
                .with("fileName", &file_name),
            )
        })?;
    let size = fs::metadata(path)
        .map_err(|e| AppError::filesystem(path, e))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(AppError::Import(
            UserMessage::new(
                "library.tooLarge",
                format!("“{file_name}” is too large to import."),
            )
            .with("fileName", &file_name),
        ));
    }
    let bytes = fs::read(path).map_err(|e| AppError::filesystem(path, e))?;
    let document = adapter.extract(&bytes, &file_name)?;

    let parser = ReferenceParser::english();
    let references = document
        .segments
        .iter()
        .enumerate()
        .flat_map(|(i, s)| parser.detect(&s.text).into_iter().map(move |r| (i, r)))
        .collect::<Vec<_>>();

    log::info!(
        "library import staged: {} ({} segments, {} references)",
        adapter.format(),
        document.segments.len(),
        references.len()
    );
    Ok(StagedSource {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_path_buf(),
        file_name,
        extension,
        size,
        hash: content_hash(&bytes),
        document,
        references,
    })
}
