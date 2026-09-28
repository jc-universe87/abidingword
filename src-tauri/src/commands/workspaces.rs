use tauri::State;

use super::CommandResult;
use crate::db::workspaces;
use crate::domain::Workspace;
use crate::state::AppState;

#[tauri::command(async)]
pub fn workspace_get_default(state: State<'_, AppState>) -> CommandResult<Workspace> {
    state.db(workspaces::get_default)
}
