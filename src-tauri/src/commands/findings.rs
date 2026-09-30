use tauri::State;

use super::CommandResult;
use crate::db::findings;
use crate::domain::{
    CreateFinding, Finding, LinkFindingPassage, Reorder, SetFindingTags, UpdateFinding,
};
use crate::state::AppState;

#[tauri::command(async)]
pub fn finding_list(state: State<'_, AppState>, study_id: String) -> CommandResult<Vec<Finding>> {
    state.db(|conn| findings::list(conn, &study_id))
}

#[tauri::command(async)]
pub fn finding_create(state: State<'_, AppState>, input: CreateFinding) -> CommandResult<Finding> {
    state.db(|conn| findings::create(conn, &input))
}

#[tauri::command(async)]
pub fn finding_update(state: State<'_, AppState>, input: UpdateFinding) -> CommandResult<Finding> {
    state.db(|conn| findings::update(conn, &input))
}

#[tauri::command(async)]
pub fn finding_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| findings::delete(conn, &id))
}

#[tauri::command(async)]
pub fn finding_reorder(state: State<'_, AppState>, input: Reorder) -> CommandResult<Vec<Finding>> {
    state.db(|conn| findings::reorder(conn, &input))
}

#[tauri::command(async)]
pub fn finding_link_passage(
    state: State<'_, AppState>,
    input: LinkFindingPassage,
) -> CommandResult<Finding> {
    state.db(|conn| findings::link_passage(conn, &input))
}

#[tauri::command(async)]
pub fn finding_unlink_passage(
    state: State<'_, AppState>,
    passage_id: String,
) -> CommandResult<Finding> {
    state.db(|conn| findings::unlink_passage(conn, &passage_id))
}

#[tauri::command(async)]
pub fn finding_set_tags(
    state: State<'_, AppState>,
    input: SetFindingTags,
) -> CommandResult<Finding> {
    state.db(|conn| findings::set_tags(conn, &input))
}
