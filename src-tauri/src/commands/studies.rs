use tauri::State;

use super::CommandResult;
use crate::db::{studies, study_search};
use crate::domain::{
    CreateStudy, DuplicateStudy, ListStudies, Study, StudyDetail, StudySearchHit, StudySummary,
    UpdateStudy,
};
use crate::state::AppState;

#[tauri::command(async)]
pub fn study_list(
    state: State<'_, AppState>,
    input: ListStudies,
) -> CommandResult<Vec<StudySummary>> {
    state.db(|conn| studies::list(conn, &input))
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

#[tauri::command(async)]
pub fn study_duplicate(
    state: State<'_, AppState>,
    input: DuplicateStudy,
) -> CommandResult<StudyDetail> {
    state.db(|conn| studies::duplicate(conn, &input))
}

#[tauri::command(async)]
pub fn study_search(
    state: State<'_, AppState>,
    query: String,
) -> CommandResult<Vec<StudySearchHit>> {
    state.db(|conn| study_search::search(conn, &query))
}
