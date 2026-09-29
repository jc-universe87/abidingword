use tauri::State;

use super::CommandResult;
use crate::db::study_passages;
use crate::scripture::{AddStudyPassage, StudyPassage};
use crate::state::AppState;

#[tauri::command(async)]
pub fn study_passage_list(
    state: State<'_, AppState>,
    study_id: String,
) -> CommandResult<Vec<StudyPassage>> {
    state.db(|conn| study_passages::list(conn, &study_id))
}

#[tauri::command(async)]
pub fn study_passage_add(
    state: State<'_, AppState>,
    input: AddStudyPassage,
) -> CommandResult<StudyPassage> {
    state.db(|conn| study_passages::add(conn, &input))
}

#[tauri::command(async)]
pub fn study_passage_remove(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| study_passages::remove(conn, &id))
}
