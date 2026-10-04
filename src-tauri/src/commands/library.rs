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
use crate::error::{AppError, ErrorPayload, UserMessage};
use crate::filesystem;
use crate::library::{adapters, contents, import, original};
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
        problem_code: problem.as_ref().and_then(|p| p.code).map(String::from),
        problem: problem.map(|p| p.text),
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
            AppError::InvalidInput(UserMessage::new(
                "import.expiredFile",
                "This import has expired. Please choose the file again.",
            ))
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
                around_page: None,
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

/// What the viewer needs to open a source's original: its kind and size.
/// Takes a source id only; the file is found and checked by the core.
#[tauri::command(async)]
pub fn library_original_info(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<original::OriginalInfo> {
    let core = state.core()?;
    let (relative, format) = core
        .db
        .with_conn(|conn| library::original_record(conn, &id))?;
    Ok(original::open(&core.dirs.sources(), &id, &relative, &format)?.info())
}

/// A bounded range of a source's original file, as raw bytes (no JSON, no
/// base64). The viewer reads only what it is showing.
#[tauri::command(async)]
pub fn library_original_read(
    state: State<'_, AppState>,
    id: String,
    offset: u64,
    length: u32,
) -> CommandResult<tauri::ipc::Response> {
    let core = state.core()?;
    let (relative, format) = core
        .db
        .with_conn(|conn| library::original_record(conn, &id))?;
    let file = original::open(&core.dirs.sources(), &id, &relative, &format)?;
    Ok(tauri::ipc::Response::new(file.read(offset, length)?))
}

/// The contents the source itself carries, as a nested tree of internal
/// targets. EPUB (its own contents) and DOCX (its headings) here (read from the
/// managed file, mapped to segment positions); a PDF's outline is read by the viewer's PDF engine. Anything
/// else, and a book without usable contents, gives an empty list.
#[tauri::command(async)]
pub fn library_source_contents(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<contents::ContentsItem>> {
    let core = state.core()?;
    let (source, record) = core.db.with_conn(|conn| {
        let source = library::get(conn, &id)?;
        let record = library::original_record(conn, &id).ok();
        Ok((source, record))
    })?;
    let Some((relative, format)) = record else {
        return Ok(Vec::new());
    };
    if format != "epub" && format != "docx" {
        return Ok(Vec::new());
    }
    let bytes = original::read_managed(&core.dirs.sources(), &id, &relative, MAX_CONTENTS_FILE)?;
    let expected = usize::try_from(source.segment_count).unwrap_or(0);
    Ok(if format == "docx" {
        adapters::docx::contents(&bytes, expected)
    } else {
        adapters::epub::contents(&bytes, expected)
    })
}

/// The links inside an EPUB's text that lead elsewhere in the same book (see
/// [`adapters::epub::links`]). Anything else gives an empty list.
#[tauri::command(async)]
pub fn library_source_links(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<contents::SourceLink>> {
    let core = state.core()?;
    let (source, record) = core.db.with_conn(|conn| {
        let source = library::get(conn, &id)?;
        let record = library::original_record(conn, &id).ok();
        Ok((source, record))
    })?;
    let Some((relative, format)) = record else {
        return Ok(Vec::new());
    };
    if format != "epub" {
        return Ok(Vec::new());
    }
    let bytes = original::read_managed(&core.dirs.sources(), &id, &relative, MAX_CONTENTS_FILE)?;
    Ok(adapters::epub::links(
        &bytes,
        usize::try_from(source.segment_count).unwrap_or(0),
    ))
}

/// Where each reading-order document of an EPUB starts among the extracted
/// text, and which segment each of its anchors falls in: what the formatted
/// view needs to move between Reading and Original. EPUB only.
#[tauri::command(async)]
pub fn library_epub_structure(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<adapters::epub_view::StructureItem>> {
    let (source, bytes) = epub_bytes(&state, &id)?;
    Ok(adapters::epub::structure(
        &bytes,
        usize::try_from(source.segment_count).unwrap_or(0),
    ))
}

/// One reading-order document of an EPUB, sanitised into a tree the
/// interface renders itself (see `adapters::epub_view`). `item` is an id
/// from [`library_epub_structure`]; anything else is refused.
#[tauri::command(async)]
pub fn library_epub_item(
    state: State<'_, AppState>,
    id: String,
    item: String,
) -> CommandResult<adapters::epub_view::EpubItem> {
    let (_, bytes) = epub_bytes(&state, &id)?;
    Ok(adapters::epub_view::render_item(&bytes, &item)?)
}

/// Where each part of a DOCX's formatted view starts among the extracted
/// text, and which segment each of its element ids falls in (the same shape as
/// [`library_epub_structure`]). DOCX only.
#[tauri::command(async)]
pub fn library_docx_structure(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<adapters::epub_view::StructureItem>> {
    let (source, bytes) = managed_bytes(&state, &id, "docx")?;
    Ok(adapters::docx::structure(
        &bytes,
        usize::try_from(source.segment_count).unwrap_or(0),
    ))
}

/// One part of a DOCX, sanitised into the same tree the formatted EPUB view
/// uses (see `adapters::docx_view`). `item` is an id from
/// [`library_docx_structure`]; anything else is refused.
#[tauri::command(async)]
pub fn library_docx_item(
    state: State<'_, AppState>,
    id: String,
    item: String,
) -> CommandResult<adapters::epub_view::EpubItem> {
    let (_, bytes) = managed_bytes(&state, &id, "docx")?;
    Ok(adapters::docx_view::render_part(&bytes, &item)?)
}

/// The managed EPUB of a source (checked as every managed file is), with its record.
fn epub_bytes(
    state: &State<'_, AppState>,
    id: &str,
) -> CommandResult<(crate::library::Source, Vec<u8>)> {
    managed_bytes(state, id, "epub")
}

/// The managed file of a source in the given format (checked as every managed
/// file is), with its record.
fn managed_bytes(
    state: &State<'_, AppState>,
    id: &str,
    wanted: &str,
) -> CommandResult<(crate::library::Source, Vec<u8>)> {
    let core = state.core()?;
    let (source, record) = core.db.with_conn(|conn| {
        let source = library::get(conn, id)?;
        let record = library::original_record(conn, id)?;
        Ok((source, record))
    })?;
    let (relative, format) = record;
    if format != wanted {
        return Err(AppError::InvalidInput(UserMessage::new(
            "library.originalUnsupported",
            "This source has no original view.",
        ))
        .into());
    }
    let bytes = original::read_managed(&core.dirs.sources(), id, &relative, MAX_CONTENTS_FILE)?;
    Ok((source, bytes))
}

/// The largest EPUB read for its contents (matches what import accepts).
const MAX_CONTENTS_FILE: u64 = 200 * 1024 * 1024;
