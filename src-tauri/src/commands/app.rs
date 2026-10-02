use serde::Serialize;
use tauri::State;

use crate::error::ErrorPayload;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    /// False when startup failed; `error` then explains why.
    pub ready: bool,
    pub error: Option<ErrorPayload>,
    pub data_directory: Option<String>,
    pub database_path: Option<String>,
    pub log_directory: Option<String>,
    pub schema_version: Option<i64>,
    /// True only in builds made by the explicit test-update workflow, which
    /// carry the updater's signing public key and endpoint. Ordinary builds
    /// (local, CI) have no updater and never touch the network for updates.
    pub updates_enabled: bool,
}

#[tauri::command(async)]
pub fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    let core = state.core().ok();
    AppInfo {
        version: app.package_info().version.to_string(),
        ready: core.is_some(),
        error: state.startup_error().cloned(),
        data_directory: core.map(|c| c.dirs.root().display().to_string()),
        database_path: core
            .and_then(|c| c.db.path())
            .map(|p| p.display().to_string()),
        log_directory: state.log_dir().map(|p| p.display().to_string()),
        schema_version: state.schema_version(),
        updates_enabled: crate::updates_configured(&app),
    }
}

const MAX_FRONTEND_LOG_CHARS: usize = 4_000;

/// Lets the interface record its own failures (for example a rendering
/// crash) in the same log file as the native core.
#[tauri::command(async)]
pub fn app_log_error(message: String) {
    let message: String = message.chars().take(MAX_FRONTEND_LOG_CHARS).collect();
    log::error!("frontend: {message}");
}
