use tauri::State;

use super::CommandResult;
use crate::db::teaching_templates;
use crate::domain::{TeachingTemplate, TeachingTemplateInput, UpdateTeachingTemplate};
use crate::state::AppState;

#[tauri::command(async)]
pub fn teaching_template_list(state: State<'_, AppState>) -> CommandResult<Vec<TeachingTemplate>> {
    state.db(teaching_templates::list)
}

#[tauri::command(async)]
pub fn teaching_template_create(
    state: State<'_, AppState>,
    input: TeachingTemplateInput,
) -> CommandResult<TeachingTemplate> {
    state.db(|conn| teaching_templates::create(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_template_update(
    state: State<'_, AppState>,
    input: UpdateTeachingTemplate,
) -> CommandResult<TeachingTemplate> {
    state.db(|conn| teaching_templates::update(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_template_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| teaching_templates::delete(conn, &id))
}
