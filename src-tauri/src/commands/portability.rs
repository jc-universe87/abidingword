//! Moving work between computers (v0.19): a project as a package, and
//! everything as a backup. The only paths these commands take are the
//! files the person picked in the system's open or save dialog.

use std::path::PathBuf;

use tauri::State;

use super::materials::{chosen_path, refuse_unasked};
use super::CommandResult;
use crate::error::{AppError, UserMessage};
use crate::portability::{backup, project};
use crate::state::AppState;

fn picked(raw: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(raw.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "portability.noFile",
            "Please choose a file.",
        )));
    }
    Ok(path)
}

/// Saves one project as a `.awproject` package. Returns where it went.
#[tauri::command(async)]
pub fn project_export(
    state: State<'_, AppState>,
    project_id: String,
    path: String,
) -> CommandResult<(String, project::ExportReport)> {
    let target = chosen_path(&path, &[project::EXTENSION])?;
    refuse_unasked(&path, &target)?;
    let images = state.core()?.dirs.teaching_images();
    let report = state.db(|conn| project::export(conn, &project_id, &images, &target))?;
    Ok((target.to_string_lossy().into_owned(), report))
}

/// What a project package holds, and what it refers to that this computer
/// does not have. Nothing is changed.
#[tauri::command(async)]
pub fn project_package_inspect(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<project::Preview> {
    let path = picked(&path)?;
    state.db(|conn| project::inspect(conn, &path))
}

/// Adds the project of a package as a new project.
#[tauri::command(async)]
pub fn project_import(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<project::ImportReport> {
    let path = picked(&path)?;
    let dirs = &state.core()?.dirs;
    let (images, cache) = (dirs.teaching_images(), dirs.cache());
    state.db(|conn| project::import(conn, &path, &images, &cache))
}

/// Saves everything as a `.awbackup` file. Returns where it went.
#[tauri::command(async)]
pub fn backup_create(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<(String, backup::BackupReport)> {
    let target = chosen_path(&path, &[backup::EXTENSION])?;
    refuse_unasked(&path, &target)?;
    let core = state.core()?;
    let report = backup::create(&core.db, &core.dirs, &target)?;
    Ok((target.to_string_lossy().into_owned(), report))
}

/// What a backup holds. Nothing is changed.
#[tauri::command(async)]
pub fn backup_inspect(state: State<'_, AppState>, path: String) -> CommandResult<backup::Preview> {
    let path = picked(&path)?;
    Ok(backup::inspect(&state.core()?.db, &path)?)
}

/// Replaces everything with a backup, after a safety copy.
#[tauri::command(async)]
pub fn backup_restore(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<backup::RestoreReport> {
    let path = picked(&path)?;
    let core = state.core()?;
    Ok(backup::restore(&core.db, &core.dirs, &path)?)
}
