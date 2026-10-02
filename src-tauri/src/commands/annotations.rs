use tauri::State;

use super::CommandResult;
use crate::db::annotations;
use crate::scripture::reference::ScriptureRef;
use crate::scripture::{AnchorInput, AnchorView, Annotation, CreateAnnotation, UpdateAnnotation};
use crate::state::AppState;

/// Annotations overlapping a passage (canonical reference). With a
/// translation, phrase anchors report whether its wording matches.
#[tauri::command(async)]
pub fn annotation_list(
    state: State<'_, AppState>,
    reference: String,
    translation_id: Option<String>,
) -> CommandResult<Vec<Annotation>> {
    let reference = ScriptureRef::from_canonical(&reference)?;
    state.db(|conn| annotations::list_for(conn, &reference, translation_id.as_deref()))
}

/// Checks a phrase selection against the stored text without saving it.
#[tauri::command(async)]
pub fn annotation_anchor_check(
    state: State<'_, AppState>,
    input: AnchorInput,
) -> CommandResult<AnchorView> {
    state.db(|conn| annotations::check_anchor(conn, &input))
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
