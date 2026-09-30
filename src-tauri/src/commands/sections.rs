use tauri::State;

use super::CommandResult;
use crate::db::sections;
use crate::domain::{
    CreateStudySection, DeleteStudySection, Reorder, StudySection, UpdateStudySection,
};
use crate::state::AppState;

#[tauri::command(async)]
pub fn study_section_list(
    state: State<'_, AppState>,
    study_id: String,
) -> CommandResult<Vec<StudySection>> {
    state.db(|conn| sections::list(conn, &study_id))
}

#[tauri::command(async)]
pub fn study_section_update(
    state: State<'_, AppState>,
    input: UpdateStudySection,
) -> CommandResult<StudySection> {
    state.db(|conn| sections::update(conn, &input))
}

#[tauri::command(async)]
pub fn study_section_create(
    state: State<'_, AppState>,
    input: CreateStudySection,
) -> CommandResult<StudySection> {
    state.db(|conn| sections::create(conn, &input))
}

#[tauri::command(async)]
pub fn study_section_delete(
    state: State<'_, AppState>,
    input: DeleteStudySection,
) -> CommandResult<()> {
    state.db(|conn| sections::delete(conn, &input))
}

#[tauri::command(async)]
pub fn study_section_reorder(
    state: State<'_, AppState>,
    input: Reorder,
) -> CommandResult<Vec<StudySection>> {
    state.db(|conn| sections::reorder(conn, &input))
}
