//! Bible management: list, import (preview → commit), remove.
//!
//! File ownership: when the user imports files, Abiding Word copies them
//! into `sources/bibles/<translation id>/` and reads only its own copy from
//! then on. Removing the Bible deletes that copy. The user's original files
//! are never modified, moved or deleted. Bundled Bibles are read from the
//! app's resources and have no copy.

use std::path::PathBuf;

use tauri::State;

use super::CommandResult;
use crate::db::bibles::{self, SourceRecord};
use crate::error::{AppError, ErrorPayload};
use crate::filesystem;
use crate::scripture::bundled::{self, BUNDLED};
use crate::scripture::import::{self, ImportOrigin, ImportPreview, SuggestedMetadata};
use crate::scripture::{BibleTranslation, BundledBibleInfo, CommitImport, ImportRequest};
use crate::state::AppState;

#[tauri::command(async)]
pub fn bible_list(state: State<'_, AppState>) -> CommandResult<Vec<BibleTranslation>> {
    state.db(bibles::list)
}

#[tauri::command(async)]
pub fn bible_get(state: State<'_, AppState>, id: String) -> CommandResult<BibleTranslation> {
    state.db(|conn| bibles::get(conn, &id))
}

/// Bibles shipped with the app, and whether each is already added.
#[tauri::command(async)]
pub fn bible_bundled_list(state: State<'_, AppState>) -> CommandResult<Vec<BundledBibleInfo>> {
    state.db(|conn| {
        BUNDLED
            .iter()
            .map(|b| {
                Ok(BundledBibleInfo {
                    id: b.id,
                    name: b.name,
                    short_name: b.short_name,
                    language: b.language,
                    license_type: b.license_type,
                    installed: bibles::find_builtin(conn, &bundled_resource_name(b.resource))?
                        .is_some(),
                })
            })
            .collect()
    })
}

fn bundled_resource_name(file: &str) -> String {
    format!("scripture/{file}")
}

/// Reads and checks the chosen files (or a bundled Bible) and returns what
/// the verification screen shows. Nothing is saved yet.
#[tauri::command(async)]
pub fn bible_import_preview(
    state: State<'_, AppState>,
    input: ImportRequest,
) -> CommandResult<ImportPreview> {
    state.core()?;
    let (paths, origin, suggested) = match input.bundled.as_deref() {
        Some(id) => {
            let bible = bundled::by_id(id).ok_or_else(|| AppError::not_found("Bible", id))?;
            let dir = state
                .resource_dir()
                .ok_or_else(|| AppError::Unexpected("resource directory unavailable".into()))?;
            let path = dir.join(bundled_resource_name(bible.resource));
            let suggested = SuggestedMetadata {
                name: bible.name.into(),
                short_name: bible.short_name.into(),
                language: bible.language.into(),
                language_code: bible.language_code.into(),
                publisher: Some(bible.publisher.into()),
                copyright_notice: Some(bible.copyright_notice.into()),
                license_type: Some(bible.license_type.into()),
            };
            (
                vec![path],
                ImportOrigin::Bundled { id: bible.id },
                suggested,
            )
        }
        None => {
            let paths: Vec<PathBuf> = input.paths.iter().map(PathBuf::from).collect();
            (paths, ImportOrigin::UserFiles, SuggestedMetadata::default())
        }
    };
    let staged = import::stage(&paths, origin)?;
    let suggested = SuggestedMetadata {
        name: if suggested.name.is_empty() {
            staged.suggested_name.clone()
        } else {
            suggested.name
        },
        ..suggested
    };
    let preview = staged.preview(suggested);
    *state.pending_import()? = Some(staged);
    Ok(preview)
}

/// Saves the previewed Bible. On any failure nothing is saved and the
/// preview stays available, so the user can correct the details and retry.
#[tauri::command(async)]
pub fn bible_import_commit(
    state: State<'_, AppState>,
    input: CommitImport,
) -> CommandResult<BibleTranslation> {
    let core = state.core()?;
    let mut pending = state.pending_import()?;
    let staged = pending
        .as_ref()
        .filter(|s| s.id == input.preview_id)
        .ok_or_else(|| {
            AppError::InvalidInput("This import has expired. Please choose the files again.".into())
        })?;

    let id = bibles::new_translation_id();
    let names = staged
        .files
        .iter()
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect::<Vec<_>>()
        .join(", ");
    let (source, copy_dir) = match &staged.origin {
        ImportOrigin::Bundled { id: bundled_id } => {
            let bible = bundled::by_id(bundled_id)
                .ok_or_else(|| AppError::not_found("Bible", *bundled_id))?;
            (
                SourceRecord {
                    origin: "bundled",
                    path: Some(bundled_resource_name(bible.resource)),
                    original_file_name: Some(bible.resource.into()),
                    format: staged.format,
                    is_builtin: true,
                },
                None,
            )
        }
        ImportOrigin::UserFiles => {
            let dir = core.dirs.bible_sources(&id);
            filesystem::copy_into(&staged.files, &dir)?;
            (
                SourceRecord {
                    origin: "managed_copy",
                    path: Some(format!("sources/bibles/{id}")),
                    original_file_name: Some(names),
                    format: staged.format,
                    is_builtin: false,
                },
                Some(dir),
            )
        }
    };

    let result = core
        .db
        .with_conn(|conn| bibles::commit_import(conn, &id, &staged.content, &input, &source));
    match result {
        Ok(translation) => {
            *pending = None;
            Ok(translation)
        }
        Err(error) => {
            if let Some(dir) = copy_dir {
                filesystem::remove_managed(&dir);
            }
            Err(ErrorPayload::from(error))
        }
    }
}

#[tauri::command(async)]
pub fn bible_import_cancel(state: State<'_, AppState>, preview_id: String) -> CommandResult<()> {
    let mut pending = state.pending_import()?;
    if pending.as_ref().is_some_and(|s| s.id == preview_id) {
        *pending = None;
    }
    Ok(())
}

/// Removes a Bible's text and Abiding Word's copy of its files. Study
/// passages, notes and other translation-independent data stay.
#[tauri::command(async)]
pub fn bible_remove(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let core = state.core()?;
    let removed = core.db.with_conn(|conn| bibles::remove(conn, &id))?;
    if removed.source_origin == "managed_copy" {
        filesystem::remove_managed(&core.dirs.bible_sources(&removed.id));
    }
    Ok(())
}
