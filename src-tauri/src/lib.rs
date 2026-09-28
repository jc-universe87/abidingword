//! Abiding Word native core.
//!
//! * `filesystem` — the local data directory
//! * `db`         — SQLite, migrations and repositories
//! * `domain`     — records, inputs and validation
//! * `commands`   — the typed API the frontend calls
//! * `state`      — startup and shared state

pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod filesystem;
pub mod integrations;
pub mod state;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use crate::error::{AppError, AppResult};
use crate::filesystem::{DataDirs, DATA_DIR_ENV, DATA_DIR_NAME};
use crate::state::AppState;

const LOG_FILE_NAME: &str = "abiding-word";

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = start(app.handle());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::app_log_error,
            commands::workspaces::workspace_get_default,
            commands::projects::project_list,
            commands::projects::project_get,
            commands::projects::project_create,
            commands::projects::project_update,
            commands::studies::study_list,
            commands::studies::study_get,
            commands::studies::study_create,
            commands::studies::study_update,
            commands::sections::study_section_list,
            commands::sections::study_section_update,
            commands::blocks::study_block_create,
            commands::blocks::study_block_update,
            commands::blocks::study_block_delete,
            commands::settings::settings_get,
            commands::settings::settings_update,
        ])
        .run(tauri::generate_context!())
        .expect("Abiding Word could not start its window");
}

fn start(app: &AppHandle) -> AppState {
    let dirs = resolve_data_root(app).and_then(DataDirs::ensure);

    // Log into the data folder when it is usable, otherwise into the
    // operating system's log folder so the failure itself is recorded.
    let (log_target, log_dir) = match &dirs {
        Ok(dirs) => (
            TargetKind::Folder {
                path: dirs.logs(),
                file_name: Some(LOG_FILE_NAME.into()),
            },
            Some(dirs.logs()),
        ),
        Err(_) => (
            TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.into()),
            },
            app.path().app_log_dir().ok(),
        ),
    };
    if let Err(e) = app.plugin(logger(log_target)) {
        eprintln!("Abiding Word could not start logging: {e}");
    }
    install_panic_logging();

    log::info!("Abiding Word {} starting", app.package_info().version);
    match &dirs {
        Ok(dirs) => log::info!("data directory: {}", dirs.root().display()),
        Err(e) => log::error!("data directory unavailable: {e}"),
    }
    AppState::start(dirs, log_dir)
}

fn resolve_data_root(app: &AppHandle) -> AppResult<PathBuf> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    app.path()
        .data_dir()
        .map(|dir| dir.join(DATA_DIR_NAME))
        .map_err(|e| AppError::Unexpected(format!("no per-user data directory available: {e}")))
}

fn logger(target: TargetKind) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([Target::new(TargetKind::Stdout), Target::new(target)])
        .level(log::LevelFilter::Info)
        .max_file_size(2_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .build()
}

/// Records panics in the log file. The user sees a plain message in the
/// interface, never Rust panic output.
fn install_panic_logging() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        default_hook(info);
    }));
}
