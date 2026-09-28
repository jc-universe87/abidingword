use tauri::State;

use super::CommandResult;
use crate::db::studies;
use crate::domain::{CreateStudy, Study, StudyDetail, UpdateStudy};
use crate::state::AppState;

#[tauri::command(async)]
pub fn study_list(state: State<'_, AppState>, project_id: String) -> CommandResult<Vec<Study>> {
    state.db(|conn| studies::list(conn, &project_id))
}

#[tauri::command(async)]
pub fn study_get(state: State<'_, AppState>, id: String) -> CommandResult<StudyDetail> {
    state.db(|conn| studies::get_detail(conn, &id))
}

#[tauri::command(async)]
pub fn study_create(state: State<'_, AppState>, input: CreateStudy) -> CommandResult<StudyDetail> {
    state.db(|conn| studies::create(conn, &input))
}

#[tauri::command(async)]
pub fn study_update(state: State<'_, AppState>, input: UpdateStudy) -> CommandResult<Study> {
    state.db(|conn| studies::update(conn, &input))
}
