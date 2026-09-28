use tauri::State;

use super::CommandResult;
use crate::db::sections;
use crate::domain::{StudySection, UpdateStudySection};
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
