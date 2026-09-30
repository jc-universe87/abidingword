use tauri::State;

use super::CommandResult;
use crate::db::templates;
use crate::domain::{StudyTemplate, TemplateInput, UpdateTemplate};
use crate::state::AppState;

#[tauri::command(async)]
pub fn template_list(state: State<'_, AppState>) -> CommandResult<Vec<StudyTemplate>> {
    state.db(templates::list)
}

#[tauri::command(async)]
pub fn template_get(state: State<'_, AppState>, id: String) -> CommandResult<StudyTemplate> {
    state.db(|conn| templates::get(conn, &id))
}

#[tauri::command(async)]
pub fn template_create(
    state: State<'_, AppState>,
    input: TemplateInput,
) -> CommandResult<StudyTemplate> {
    state.db(|conn| templates::create(conn, &input))
}

#[tauri::command(async)]
pub fn template_update(
    state: State<'_, AppState>,
    input: UpdateTemplate,
) -> CommandResult<StudyTemplate> {
    state.db(|conn| templates::update(conn, &input))
}

#[tauri::command(async)]
pub fn template_duplicate(state: State<'_, AppState>, id: String) -> CommandResult<StudyTemplate> {
    state.db(|conn| templates::duplicate(conn, &id))
}

#[tauri::command(async)]
pub fn template_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| templates::delete(conn, &id))
}
