use tauri::State;

use super::CommandResult;
use crate::assistant::images;
use crate::db::teaching;
use crate::domain::{
    AddTeachingPassage, CreateTeaching, CreateTeachingPoint, KeepTeachingMaterial,
    LinkTeachingFinding, Reorder, TeachingPreparation, TeachingSummary, UpdateTeaching,
    UpdateTeachingPoint,
};
use crate::error::{AppError, UserMessage};
use crate::state::AppState;

#[tauri::command(async)]
pub fn teaching_list(
    state: State<'_, AppState>,
    study_id: String,
) -> CommandResult<Vec<TeachingSummary>> {
    state.db(|conn| teaching::list(conn, &study_id))
}

#[tauri::command(async)]
pub fn teaching_get(state: State<'_, AppState>, id: String) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::get(conn, &id))
}

#[tauri::command(async)]
pub fn teaching_create(
    state: State<'_, AppState>,
    input: CreateTeaching,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::create(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_update(
    state: State<'_, AppState>,
    input: UpdateTeaching,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::update(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| teaching::delete(conn, &id))
}

#[tauri::command(async)]
pub fn teaching_point_create(
    state: State<'_, AppState>,
    input: CreateTeachingPoint,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::create_point(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_point_update(
    state: State<'_, AppState>,
    input: UpdateTeachingPoint,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::update_point(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_point_delete(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::delete_point(conn, &id))
}

#[tauri::command(async)]
pub fn teaching_point_reorder(
    state: State<'_, AppState>,
    input: Reorder,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::reorder_points(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_finding_link(
    state: State<'_, AppState>,
    input: LinkTeachingFinding,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::link_finding(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_finding_unlink(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::unlink_finding(conn, &id))
}

#[tauri::command(async)]
pub fn teaching_passage_add(
    state: State<'_, AppState>,
    input: AddTeachingPassage,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::add_passage(conn, &input))
}

#[tauri::command(async)]
pub fn teaching_passage_remove(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::remove_passage(conn, &id))
}

/// Keeps something from the assistant. A generated image is written to the
/// data folder only now, when the person keeps it.
#[tauri::command(async)]
pub fn teaching_material_keep(
    state: State<'_, AppState>,
    input: KeepTeachingMaterial,
) -> CommandResult<TeachingPreparation> {
    let file = input.image.as_ref().and_then(|i| i.file.clone());
    let mut written = None;
    if let Some(file) = file.as_deref() {
        if !teaching::is_generated_file_name(file) {
            return Err(gone().into());
        }
        // Still held until it is really kept, so a refusal can be retried.
        let png = state.held_generated(file)?.ok_or_else(gone)?;
        let dir = state.core()?.dirs.teaching_images();
        std::fs::create_dir_all(&dir).map_err(|e| AppError::filesystem(&dir, e))?;
        let path = dir.join(file);
        std::fs::write(&path, &png).map_err(|e| AppError::filesystem(&path, e))?;
        written = Some(path);
    }
    let result = state.db(|conn| teaching::keep_material(conn, &input));
    match (&result, written) {
        (Err(_), Some(path)) => {
            let _ = std::fs::remove_file(path);
        }
        (Ok(_), Some(_)) => {
            if let Some(file) = file.as_deref() {
                state.take_generated(file)?;
            }
        }
        _ => {}
    }
    result
}

fn gone() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "teaching.imageGone",
        "This image is no longer available. Please make it again.",
    ))
}

#[tauri::command(async)]
pub fn teaching_material_remove(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<TeachingPreparation> {
    state.db(|conn| teaching::remove_material(conn, &id))
}

/// A kept generated image, for showing it.
#[tauri::command(async)]
pub fn teaching_image(state: State<'_, AppState>, file: String) -> CommandResult<String> {
    if !teaching::is_generated_file_name(&file) {
        return Err(gone().into());
    }
    let path = state.core()?.dirs.teaching_images().join(&file);
    let png = std::fs::read(&path).map_err(|_| gone())?;
    Ok(images::data_url(&png))
}
