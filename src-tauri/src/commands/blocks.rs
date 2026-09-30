use tauri::State;

use super::CommandResult;
use crate::db::blocks;
use crate::domain::{CreateStudyBlock, Reorder, StudyBlock, UpdateStudyBlock};
use crate::state::AppState;

#[tauri::command(async)]
pub fn study_block_create(
    state: State<'_, AppState>,
    input: CreateStudyBlock,
) -> CommandResult<StudyBlock> {
    state.db(|conn| blocks::create(conn, &input))
}

#[tauri::command(async)]
pub fn study_block_update(
    state: State<'_, AppState>,
    input: UpdateStudyBlock,
) -> CommandResult<StudyBlock> {
    state.db(|conn| blocks::update(conn, &input))
}

#[tauri::command(async)]
pub fn study_block_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| blocks::delete(conn, &id))
}

#[tauri::command(async)]
pub fn study_block_reorder(
    state: State<'_, AppState>,
    input: Reorder,
) -> CommandResult<Vec<StudyBlock>> {
    state.db(|conn| blocks::reorder(conn, &input))
}
