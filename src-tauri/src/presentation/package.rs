//! The delivery package: one presentation as a single, self-contained JSON
//! file — the document with its images inside. Made from the same document
//! as every other output, it can be presented without the desktop database
//! (the base for offline delivery on another device later). The same
//! content always gives the same file.

use base64::Engine as _;
use rusqlite::Connection;

use super::document::{self, PresentationDocument};
use super::images::{self, ImageStore};
use crate::db::{presentations, teaching};
use crate::error::{AppError, AppResult};

/// The document with every available image embedded.
pub fn build(conn: &Connection, id: &str, store: &ImageStore) -> AppResult<PresentationDocument> {
    let mut doc = document::build(conn, id, store)?;
    let presentation = presentations::get(conn, id)?;
    let prep = teaching::get(conn, &presentation.preparation_id)?;
    for asset in doc.images.iter_mut().filter(|a| a.available) {
        let file = prep
            .materials
            .iter()
            .find(|m| m.id == asset.id)
            .and_then(|m| store.path_for(m))
            .and_then(|p| images::read_file(&p));
        match file {
            Some((bytes, _)) => {
                asset.data = Some(base64::engine::general_purpose::STANDARD.encode(bytes));
            }
            None => asset.available = false,
        }
    }
    Ok(doc)
}

pub fn to_json(doc: &PresentationDocument) -> AppResult<String> {
    serde_json::to_string_pretty(doc)
        .map(|mut s| {
            s.push('\n');
            s
        })
        .map_err(|e| AppError::Unexpected(format!("delivery package: {e}")))
}

/// Reads a package back (for tests now; for a mobile reader later). A
/// package from a newer version is refused rather than misread.
pub fn from_json(text: &str) -> AppResult<PresentationDocument> {
    let doc: PresentationDocument = serde_json::from_str(text)
        .map_err(|e| AppError::Unexpected(format!("delivery package: {e}")))?;
    if doc.format != document::FORMAT || doc.schema_version > document::SCHEMA_VERSION {
        return Err(AppError::Unexpected(
            "this delivery package was made by a newer version".to_string(),
        ));
    }
    Ok(doc)
}
