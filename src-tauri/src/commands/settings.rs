use tauri::State;

use super::CommandResult;
use crate::db::settings;
use crate::domain::{AppSettings, UpdateSettings};
use crate::state::AppState;

#[tauri::command(async)]
pub fn settings_get(state: State<'_, AppState>) -> CommandResult<AppSettings> {
    state.db(settings::get)
}

#[tauri::command(async)]
pub fn settings_update(
    state: State<'_, AppState>,
    input: UpdateSettings,
) -> CommandResult<AppSettings> {
    state.db(|conn| settings::update(conn, &input))
}
