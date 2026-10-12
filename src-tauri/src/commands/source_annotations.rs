use tauri::State;

use super::CommandResult;
use crate::db::source_annotations;
use crate::library::annotations::{
    CreateSourceAnnotation, MarkedSource, SourceAnnotation, SourceMarksPage, SourceMarksQuery,
    UpdateSourceAnnotation,
};
use crate::state::AppState;

/// A source's highlights, notes and bookmarks in reading order, each found
/// again in the stored text first.
#[tauri::command(async)]
pub fn source_annotation_list(
    state: State<'_, AppState>,
    source_id: String,
) -> CommandResult<Vec<SourceAnnotation>> {
    state.db(|conn| source_annotations::list_for_source(conn, &source_id))
}

#[tauri::command(async)]
pub fn source_annotation_create(
    state: State<'_, AppState>,
    input: CreateSourceAnnotation,
) -> CommandResult<SourceAnnotation> {
    state.db(|conn| source_annotations::create(conn, &input))
}

#[tauri::command(async)]
pub fn source_annotation_update(
    state: State<'_, AppState>,
    input: UpdateSourceAnnotation,
) -> CommandResult<SourceAnnotation> {
    state.db(|conn| source_annotations::update(conn, &input))
}

#[tauri::command(async)]
pub fn source_annotation_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| source_annotations::delete(conn, &id))
}

/// A page of the marks in library sources, for the Marks view.
#[tauri::command(async)]
pub fn source_marks_list(
    state: State<'_, AppState>,
    query: SourceMarksQuery,
) -> CommandResult<SourceMarksPage> {
    state.db(|conn| source_annotations::marks(conn, &query))
}

/// The sources that have marks, for the Marks view's choice of source.
#[tauri::command(async)]
pub fn source_marks_sources(state: State<'_, AppState>) -> CommandResult<Vec<MarkedSource>> {
    state.db(source_annotations::marked_sources)
}
