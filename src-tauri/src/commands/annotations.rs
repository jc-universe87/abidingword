use tauri::State;

use super::CommandResult;
use crate::db::annotations;
use crate::scripture::reference::ScriptureRef;
use crate::scripture::{Annotation, CreateAnnotation, UpdateAnnotation};
use crate::state::AppState;

/// Annotations overlapping a passage (canonical reference).
#[tauri::command(async)]
pub fn annotation_list(
    state: State<'_, AppState>,
    reference: String,
) -> CommandResult<Vec<Annotation>> {
    let reference = ScriptureRef::from_canonical(&reference)?;
    state.db(|conn| annotations::list(conn, &reference))
}

#[tauri::command(async)]
pub fn annotation_create(
    state: State<'_, AppState>,
    input: CreateAnnotation,
) -> CommandResult<Annotation> {
    state.db(|conn| annotations::create(conn, &input))
}

#[tauri::command(async)]
pub fn annotation_update(
    state: State<'_, AppState>,
    input: UpdateAnnotation,
) -> CommandResult<Annotation> {
    state.db(|conn| annotations::update(conn, &input))
}

#[tauri::command(async)]
pub fn annotation_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| annotations::delete(conn, &id))
}
