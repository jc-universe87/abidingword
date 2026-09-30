//! The personal library: import (preview → commit), list, read, search,
//! Scripture mentions, removal, and finding citations.
//!
//! File ownership: an imported file is copied into
//! `sources/<category>/<source id>/` and only that copy is used; the user's
//! original is never changed. Removing a source deletes Abiding Word's copy.

use std::fs;
use std::path::PathBuf;

use tauri::State;

use super::CommandResult;
use crate::db::{findings, library};
use crate::domain::Finding;
use crate::error::{AppError, ErrorPayload};
use crate::filesystem;
use crate::library::{adapters, import};
use crate::library::{
    AddFindingSource, CommitSourceImport, FindingCitation, GetSegments, LibraryResults,
    ListSources, PassageMention, SearchLibrary, SegmentWindow, Source, SourceImportPreview,
    SourceSummary, SourceType,
};
use crate::scripture::reference::ScriptureRef;
use crate::state::AppState;

#[tauri::command(async)]
pub fn library_list(
    state: State<'_, AppState>,
    input: ListSources,
) -> CommandResult<Vec<SourceSummary>> {
    state.db(|conn| library::list(conn, &input))
}

/// Languages present in the library, for the filter.
#[tauri::command(async)]
pub fn library_languages(state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    state.db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT language FROM sources WHERE deleted_at IS NULL AND language IS NOT NULL
             ORDER BY language COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[tauri::command(async)]
pub fn library_get_source(state: State<'_, AppState>, id: String) -> CommandResult<Source> {
    state.db(|conn| library::get(conn, &id))
}

/// Reads and checks one chosen file; nothing is saved yet.
#[tauri::command(async)]
pub fn library_import_preview(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<SourceImportPreview> {
    state.core()?;
    let staged = import::stage(&PathBuf::from(&path))?;
    let duplicate_of = state.db(|conn| library::find_duplicate(conn, &staged.hash))?;
    let doc = &staged.document;
    let stem = staged
        .file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_else(|| staged.file_name.clone());
    let problem = staged.problem();
    let preview = SourceImportPreview {
        preview_id: staged.id.clone(),
        file_name: staged.file_name.clone(),
        format: doc.format,
        suggested_title: doc.metadata.title.clone().unwrap_or(stem),
        suggested_author: doc.metadata.author.clone(),
        suggested_language: doc
            .metadata
            .language
            .as_deref()
            .map(adapters::language_name),
        suggested_publisher: doc.metadata.publisher.clone(),
        suggested_isbn: doc.metadata.isbn.clone(),
        suggested_type: SourceType::default_for(doc.format),
        page_count: doc.page_count,
        chapter_count: doc.chapter_count,
        segment_count: doc.segments.len(),
        reference_count: staged.references.len(),
        extraction_status: doc.extraction_status.as_str(),
        can_import: problem.is_none(),
        problem,
        duplicate_of,
    };
    *state.pending_source()? = Some(staged);
    Ok(preview)
}

/// Copies the file into the library and saves everything in one step. On
/// any failure nothing is kept (not even the copied file) and the preview
/// stays available to retry.
#[tauri::command(async)]
pub fn library_import_commit(
    state: State<'_, AppState>,
    input: CommitSourceImport,
) -> CommandResult<Source> {
    let core = state.core()?;
    let mut pending = state.pending_source()?;
    let staged = pending
        .as_ref()
        .filter(|s| s.id == input.preview_id)
        .ok_or_else(|| {
            AppError::InvalidInput("This import has expired. Please choose the file again.".into())
        })?;
    if let Some(problem) = staged.problem() {
        return Err(AppError::Import(problem).into());
    }
    let source_id = crate::db::new_id();
    let relative = library::managed_relative_path(&source_id, staged);
    let target = core.dirs.sources().join(&relative);
    let folder = target
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| core.dirs.sources());
    let copied = (|| {
        fs::create_dir_all(&folder).map_err(|e| AppError::filesystem(&folder, e))?;
        fs::copy(&staged.path, &target).map_err(|e| AppError::filesystem(&staged.path, e))?;
        Ok::<_, AppError>(())
    })();
    if let Err(error) = copied {
        filesystem::remove_managed(&folder);
        return Err(error.into());
    }
    match core
        .db
        .with_conn(|conn| library::commit_import(conn, &source_id, staged, &input, &relative))
    {
        Ok(source) => {
            *pending = None;
            Ok(source)
        }
        Err(error) => {
            filesystem::remove_managed(&folder);
            Err(ErrorPayload::from(error))
        }
    }
}

#[tauri::command(async)]
pub fn library_import_cancel(state: State<'_, AppState>, preview_id: String) -> CommandResult<()> {
    let mut pending = state.pending_source()?;
    if pending.as_ref().is_some_and(|s| s.id == preview_id) {
        *pending = None;
    }
    Ok(())
}

/// Removes a source's text and Abiding Word's copy of the file. Findings
/// that cite it keep a record of the citation.
#[tauri::command(async)]
pub fn library_remove_source(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let core = state.core()?;
    let file = core.db.with_conn(|conn| library::remove(conn, &id))?;
    if let Some(relative) = file {
        if let Some(folder) = core.dirs.sources().join(relative).parent() {
            // Only ever the source's own folder inside sources/.
            if folder.starts_with(core.dirs.sources()) && folder.ends_with(&id) {
                filesystem::remove_managed(folder);
            }
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn library_search(
    state: State<'_, AppState>,
    input: SearchLibrary,
) -> CommandResult<LibraryResults> {
    state.db(|conn| library::search(conn, &input))
}

/// Opens a source at an exact segment (search result, citation, mention).
#[tauri::command(async)]
pub fn library_open_segment(
    state: State<'_, AppState>,
    segment_id: String,
) -> CommandResult<SegmentWindow> {
    state.db(|conn| {
        let (source_id, _) = library::segment(conn, &segment_id)?;
        library::segments(
            conn,
            &GetSegments {
                source_id,
                around_segment_id: Some(segment_id.clone()),
                offset: None,
                limit: None,
            },
        )
    })
}

#[tauri::command(async)]
pub fn source_get_segments(
    state: State<'_, AppState>,
    input: GetSegments,
) -> CommandResult<SegmentWindow> {
    state.db(|conn| library::segments(conn, &input))
}

#[tauri::command(async)]
pub fn source_get_passages(
    state: State<'_, AppState>,
    source_id: String,
) -> CommandResult<Vec<PassageMention>> {
    state.db(|conn| library::passages(conn, &source_id))
}

/// Library places mentioning a passage (canonical reference).
#[tauri::command(async)]
pub fn library_sources_for_passage(
    state: State<'_, AppState>,
    reference: String,
) -> CommandResult<Vec<PassageMention>> {
    let reference = ScriptureRef::from_canonical(&reference)?;
    state.db(|conn| library::mentions(conn, &reference))
}

#[tauri::command(async)]
pub fn finding_source_add(
    state: State<'_, AppState>,
    input: AddFindingSource,
) -> CommandResult<Finding> {
    state.db(|conn| findings::add_source(conn, &input))
}

#[tauri::command(async)]
pub fn finding_source_remove(
    state: State<'_, AppState>,
    citation_id: String,
) -> CommandResult<Finding> {
    state.db(|conn| findings::remove_source(conn, &citation_id))
}

#[tauri::command(async)]
pub fn finding_source_list(
    state: State<'_, AppState>,
    finding_id: String,
) -> CommandResult<Vec<FindingCitation>> {
    state.db(|conn| Ok(findings::get(conn, &finding_id)?.sources))
}
