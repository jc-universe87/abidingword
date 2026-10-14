//! The personal library: import (preview → commit), list, read, search,
//! Scripture mentions, removal, and finding citations.
//!
//! File ownership: an imported file is copied into
//! `sources/<category>/<source id>/` and only that copy is used; the user's
//! original is never changed. Removing a source deletes Abiding Word's copy.

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use tauri::State;

use super::CommandResult;
use crate::db::{findings, library};
use crate::domain::Finding;
use crate::error::{AppError, ErrorPayload, UserMessage};
use crate::filesystem;
use crate::library::{adapters, contents, generated_contents, import, original};
use crate::library::{
    AddFindingSource, CitationPlace, CommitSourceImport, CreateFindingFromSource, FindingCitation,
    GetSegments, LibraryResults, ListSources, PassageLocation, PassageMention, PassageSourceGroup,
    SearchLibrary, SegmentPassageLink, SegmentWindow, Source, SourceFind, SourceImportPreview,
    SourceReference, SourceSummary, SourceType,
};
use crate::scripture::parser::DetectedReference;
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
        reference_count: staged.index.references.len(),
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

/// The sources that fit a passage (canonical reference), best first, each with
/// its best places and why they were chosen. Reads indexed links only.
#[tauri::command(async)]
pub fn library_passage_sources(
    state: State<'_, AppState>,
    reference: String,
) -> CommandResult<Vec<PassageSourceGroup>> {
    let reference = ScriptureRef::from_canonical(&reference)?;
    state.db(|conn| library::passage_sources(conn, &reference))
}

/// All the places in one source that fit a passage (canonical reference), in the
/// order the Sources pane ranks them. Reads indexed links only; bounded.
#[tauri::command(async)]
pub fn library_passage_source_locations(
    state: State<'_, AppState>,
    source_id: String,
    reference: String,
) -> CommandResult<Vec<PassageLocation>> {
    let reference = ScriptureRef::from_canonical(&reference)?;
    state.db(|conn| library::passage_source_locations(conn, &reference, &source_id))
}

/// The Scripture references written in a source's text, with where each is in
/// its segment (v0.11, the Reading view's "Open in Bible"). From the stored
/// index; nothing is parsed again.
#[tauri::command(async)]
pub fn library_source_references(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<SourceReference>> {
    state.db(|conn| library::source_references(conn, &id))
}

/// Where a query occurs in one source's text (v0.13, "Find in this source").
#[tauri::command(async)]
pub fn library_source_find(
    state: State<'_, AppState>,
    id: String,
    query: String,
) -> CommandResult<SourceFind> {
    state.db(|conn| library::find_in_source(conn, &id, &query))
}

/// The Scripture references in pieces of a source's drawn text (a formatted
/// page's text nodes), read in the source's own language (v0.11).
#[tauri::command(async)]
pub fn library_detect_references(
    state: State<'_, AppState>,
    id: String,
    texts: Vec<String>,
    scope: Option<library::DrawnScope>,
) -> CommandResult<Vec<Vec<DetectedReference>>> {
    state.db(|conn| library::detect_in_source(conn, &id, &texts, scope))
}

/// Why a segment is linked to Scripture: what it mentions and the section it
/// belongs to.
#[tauri::command(async)]
pub fn source_segment_passage_links(
    state: State<'_, AppState>,
    segment_id: String,
) -> CommandResult<Vec<SegmentPassageLink>> {
    state.db(|conn| library::segment_passage_links(conn, &segment_id))
}

#[tauri::command(async)]
pub fn finding_source_add(
    state: State<'_, AppState>,
    input: AddFindingSource,
) -> CommandResult<Finding> {
    state.db(|conn| findings::add_source(conn, &input))
}

/// "Add to Study" (v0.15): a new finding from selected words, a place or a
/// source mark, with its citation, in one step.
#[tauri::command(async)]
pub fn finding_create_from_source(
    state: State<'_, AppState>,
    input: CreateFindingFromSource,
) -> CommandResult<Finding> {
    state.db(|conn| findings::create_from_source(conn, &input))
}

/// Where a citation is in its source now, to open it there (v0.15); null
/// when the source has been removed.
#[tauri::command(async)]
pub fn finding_source_locate(
    state: State<'_, AppState>,
    citation_id: String,
) -> CommandResult<Option<CitationPlace>> {
    state.db(|conn| findings::locate_source(conn, &citation_id))
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
    // A DOCX carries no contents of its own; its headings are generated contents.
    if format != "epub" {
        return Ok(Vec::new());
    }
    let bytes = original::read_managed(&core.dirs.sources(), &id, &relative, MAX_CONTENTS_FILE)?;
    let expected = usize::try_from(source.segment_count).unwrap_or(0);
    Ok(adapters::epub::contents(&bytes, expected))
}

/// Contents made from the source's own structure, for a source that carries
/// none (v0.13): a DOCX's Word headings, an EPUB's or Markdown file's
/// headings, a PDF's probable headings (see `library::generated_contents`).
/// The interface shows them as generated. Empty when nothing is clear enough.
#[tauri::command(async)]
pub fn library_generated_contents(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Vec<contents::ContentsItem>> {
    let core = state.core()?;
    let (source, record) = core.db.with_conn(|conn| {
        let source = library::get(conn, &id)?;
        let record = library::original_record(conn, &id).ok();
        Ok((source, record))
    })?;
    match record {
        Some((relative, format)) if format == "docx" => {
            let bytes =
                original::read_managed(&core.dirs.sources(), &id, &relative, MAX_CONTENTS_FILE)?;
            let expected = usize::try_from(source.segment_count).unwrap_or(0);
            Ok(adapters::docx::contents(&bytes, expected))
        }
        Some((relative, format)) if format == "pdf" => {
            if let Some(found) = generated_cache_get(&id) {
                return Ok(found);
            }
            let bytes =
                original::read_managed(&core.dirs.sources(), &id, &relative, MAX_CONTENTS_FILE)?;
            let found = generated_contents::from_pdf(&bytes);
            generated_cache_put(&id, &found);
            Ok(found)
        }
        _ => Ok(core
            .db
            .with_conn(|conn| library::generated_contents(conn, &id))?),
    }
}

/// Generated PDF contents already worked out this session (reading a whole
/// PDF again for each opening would be slow), a few sources at most.
type GeneratedCache = Mutex<Vec<(String, Vec<contents::ContentsItem>)>>;

fn generated_cache() -> &'static GeneratedCache {
    static CACHE: OnceLock<GeneratedCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::new()))
}
const GENERATED_CACHE_SOURCES: usize = 8;

fn generated_cache_get(id: &str) -> Option<Vec<contents::ContentsItem>> {
    let cache = generated_cache().lock().ok()?;
    cache.iter().find(|(k, _)| k == id).map(|(_, v)| v.clone())
}

fn generated_cache_put(id: &str, items: &[contents::ContentsItem]) {
    if let Ok(mut cache) = generated_cache().lock() {
        cache.retain(|(k, _)| k != id);
        cache.push((id.to_string(), items.to_vec()));
        if cache.len() > GENERATED_CACHE_SOURCES {
            cache.remove(0);
        }
    }
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
