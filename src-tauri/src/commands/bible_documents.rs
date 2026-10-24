//! Reading Bibles kept as documents (v0.23): their files' original view
//! (PDF pages, EPUB and DOCX formatting), their text, search, where a verse
//! came from, and finding verses in a document Bible later.
//!
//! The interface never sees a path. It asks by document id; the core finds
//! that document's managed copy, checks it lies inside its own Bible's folder
//! (`sources/bibles/<translation id>/`, exactly as the library checks its
//! sources, `library::original`) and returns bounded bytes or the sanitised
//! trees the library's viewers already show.

use std::path::PathBuf;

use tauri::State;

use super::CommandResult;
use crate::db::bible_documents::{self, BibleDocument, DocumentHit, DocumentWindow, VerseOrigin};
use crate::db::bibles;
use crate::error::{AppError, UserMessage};
use crate::library::adapters::{self, epub_view::EpubItem, epub_view::StructureItem};
use crate::library::original::{self, OriginalInfo};
use crate::scripture::import::{self, ImportOrigin, ImportPreview, SuggestedMetadata};
use crate::scripture::BibleTranslation;
use crate::state::AppState;

/// The most a document file read whole may weigh (an EPUB or DOCX for its pages).
const MAX_WHOLE_READ: u64 = 200 * 1024 * 1024;

/// The documents a Bible was added from, in order.
#[tauri::command(async)]
pub fn bible_documents(
    state: State<'_, AppState>,
    translation_id: String,
) -> CommandResult<Vec<BibleDocument>> {
    state.db(|conn| bible_documents::list(conn, &translation_id))
}

/// The managed copy of a document, checked: its Bible id and its path
/// relative to `sources/`.
fn managed(
    state: &State<'_, AppState>,
    document_id: &str,
) -> CommandResult<(String, String, String)> {
    let core = state.core()?;
    let record = core
        .db
        .with_conn(|conn| bible_documents::record(conn, document_id))?;
    let relative = format!("bibles/{}/{}", record.translation_id, record.file_name);
    Ok((record.translation_id, relative, record.format))
}

/// What the original viewer needs to know of a PDF document.
#[tauri::command(async)]
pub fn bible_document_info(
    state: State<'_, AppState>,
    document_id: String,
) -> CommandResult<OriginalInfo> {
    let core = state.core()?;
    let (translation, relative, format) = managed(&state, &document_id)?;
    Ok(original::open(&core.dirs.sources(), &translation, &relative, &format)?.info())
}

/// A bounded range of a PDF document's bytes (no JSON, no base64).
#[tauri::command(async)]
pub fn bible_document_read(
    state: State<'_, AppState>,
    document_id: String,
    offset: u64,
    length: u32,
) -> CommandResult<tauri::ipc::Response> {
    let core = state.core()?;
    let (translation, relative, format) = managed(&state, &document_id)?;
    let file = original::open(&core.dirs.sources(), &translation, &relative, &format)?;
    Ok(tauri::ipc::Response::new(file.read(offset, length)?))
}

fn whole(
    state: &State<'_, AppState>,
    document_id: &str,
    wanted: &str,
) -> CommandResult<(Vec<u8>, usize)> {
    let core = state.core()?;
    let (translation, relative, format) = managed(state, document_id)?;
    if format != wanted {
        return Err(AppError::InvalidInput(UserMessage::new(
            "library.originalUnsupported",
            "This source has no original view.",
        ))
        .into());
    }
    let count = core
        .db
        .with_conn(|conn| bible_documents::record(conn, document_id))?
        .segment_count;
    let bytes = original::read_managed(
        &core.dirs.sources(),
        &translation,
        &relative,
        MAX_WHOLE_READ,
    )?;
    Ok((bytes, usize::try_from(count).unwrap_or(0)))
}

/// The formatted view's parts of an EPUB or DOCX document (as the library's).
#[tauri::command(async)]
pub fn bible_document_structure(
    state: State<'_, AppState>,
    document_id: String,
    kind: String,
) -> CommandResult<Vec<StructureItem>> {
    Ok(match kind.as_str() {
        "epub" => {
            let (bytes, count) = whole(&state, &document_id, "epub")?;
            adapters::epub::structure(&bytes, count)
        }
        "docx" => {
            let (bytes, count) = whole(&state, &document_id, "docx")?;
            adapters::docx::structure(&bytes, count)
        }
        _ => Vec::new(),
    })
}

/// One part of an EPUB or DOCX document, sanitised (as the library's).
#[tauri::command(async)]
pub fn bible_document_item(
    state: State<'_, AppState>,
    document_id: String,
    kind: String,
    item: String,
) -> CommandResult<EpubItem> {
    match kind.as_str() {
        "epub" => {
            let (bytes, _) = whole(&state, &document_id, "epub")?;
            Ok(adapters::epub_view::render_item(&bytes, &item)?)
        }
        "docx" => {
            let (bytes, _) = whole(&state, &document_id, "docx")?;
            Ok(adapters::docx_view::render_part(&bytes, &item)?)
        }
        _ => Err(AppError::InvalidInput(UserMessage::new(
            "library.originalUnsupported",
            "This source has no original view.",
        ))
        .into()),
    }
}

/// Paragraphs of a document's text.
#[tauri::command(async)]
pub fn bible_document_segments(
    state: State<'_, AppState>,
    document_id: String,
    offset: Option<i64>,
    limit: Option<i64>,
    around_page: Option<i64>,
) -> CommandResult<DocumentWindow> {
    state.db(|conn| {
        bible_documents::segments(
            conn,
            &document_id,
            offset.unwrap_or(0),
            limit.unwrap_or(200),
            around_page,
        )
    })
}

/// Searches the text of a Bible kept as a document.
#[tauri::command(async)]
pub fn bible_document_search(
    state: State<'_, AppState>,
    translation_id: String,
    query: String,
) -> CommandResult<Vec<DocumentHit>> {
    state.db(|conn| bible_documents::search(conn, &translation_id, &query))
}

/// Where a verse of a Bible added from documents came from.
#[tauri::command(async)]
pub fn bible_verse_origin(
    state: State<'_, AppState>,
    translation_id: String,
    book: String,
    chapter: u16,
    verse: u16,
) -> CommandResult<Option<VerseOrigin>> {
    let book = crate::scripture::canon::by_code(&book)
        .ok_or_else(|| AppError::not_found("book", &book))?;
    let key = crate::scripture::reference::verse_key(book.ordinal, chapter, verse);
    state.db(|conn| bible_documents::origin(conn, &translation_id, key))
}

/// Reads a document Bible's kept files again for books, chapters and verses
/// (no new import, nothing saved): the same review as when it was added.
#[tauri::command(async)]
pub fn bible_document_recognise(
    state: State<'_, AppState>,
    translation_id: String,
) -> CommandResult<ImportPreview> {
    let core = state.core()?;
    let translation = core
        .db
        .with_conn(|conn| bibles::get(conn, &translation_id))?;
    if translation.kind != "document" {
        return Err(AppError::InvalidInput(UserMessage::new(
            "bibles.alreadyVerses",
            "This Bible can already be read by book, chapter and verse.",
        ))
        .into());
    }
    let documents = core
        .db
        .with_conn(|conn| bible_documents::list(conn, &translation_id))?;
    let mut paths: Vec<PathBuf> = Vec::new();
    for document in &documents {
        let (_, relative, _) = managed(&state, &document.id)?;
        // The kept file, checked as every managed file is.
        paths.push(original::verified_path(
            &core.dirs.sources(),
            &translation_id,
            &relative,
        )?);
    }
    let staged = import::stage_documents(
        &paths,
        ImportOrigin::Existing {
            translation_id: translation_id.clone(),
        },
    )?;
    let preview = staged.preview(SuggestedMetadata {
        name: translation.name.clone(),
        ..SuggestedMetadata::default()
    });
    *state.pending_import()? = Some(staged);
    Ok(preview)
}

/// Gives a document Bible the verses previewed by [`bible_document_recognise`].
#[tauri::command(async)]
pub fn bible_document_add_verses(
    state: State<'_, AppState>,
    preview_id: String,
) -> CommandResult<BibleTranslation> {
    let core = state.core()?;
    let mut pending = state.pending_import()?;
    let staged = pending
        .as_ref()
        .filter(|s| s.id == preview_id)
        .ok_or_else(|| {
            AppError::InvalidInput(UserMessage::new(
                "import.expired",
                "This import has expired. Please choose the files again.",
            ))
        })?;
    let (ImportOrigin::Existing { translation_id }, Some(stage)) =
        (&staged.origin, &staged.documents)
    else {
        return Err(AppError::InvalidInput(UserMessage::new(
            "import.expired",
            "This import has expired. Please choose the files again.",
        ))
        .into());
    };
    let translation = core.db.with_conn(|conn| {
        bible_documents::add_verses(conn, translation_id, &staged.content, stage)
    })?;
    *pending = None;
    Ok(translation)
}
