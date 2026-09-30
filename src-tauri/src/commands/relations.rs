use tauri::State;

use super::CommandResult;
use crate::db::relations;
use crate::domain::{CreateStudyRelation, StudyRelation};
use crate::state::AppState;

#[tauri::command(async)]
pub fn study_relation_list(
    state: State<'_, AppState>,
    study_id: String,
) -> CommandResult<Vec<StudyRelation>> {
    state.db(|conn| relations::list(conn, &study_id))
}

#[tauri::command(async)]
pub fn study_relation_create(
    state: State<'_, AppState>,
    input: CreateStudyRelation,
) -> CommandResult<StudyRelation> {
    state.db(|conn| relations::create(conn, &input))
}

#[tauri::command(async)]
pub fn study_relation_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| relations::delete(conn, &id))
}
