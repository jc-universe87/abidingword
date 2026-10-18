//! Church presentation templates (v0.18.1): kept, chosen, designed,
//! imported and taken to another installation. Files are read only where
//! the person chose them in the system's file dialog; nothing is sent
//! anywhere and no teaching is changed.

use std::path::PathBuf;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::presentations::{store, write_atomically};
use super::CommandResult;
use crate::db::presentation_templates as templates;
use crate::domain::{
    CreatePresentationTemplate, PresentationTemplate, PresentationTemplateSummary,
    UpdatePresentationTemplate,
};
use crate::error::{AppError, UserMessage};
use crate::presentation::font_catalog::{self, InstalledFont};
use crate::presentation::pptx_import::{self, ImportedTemplate};
use crate::presentation::template::{TemplateAsset, TemplateDefinition};
use crate::presentation::template_store::{self, TemplateStore};
use crate::state::AppState;

fn kept(state: &AppState) -> Result<TemplateStore, crate::error::ErrorPayload> {
    Ok(store(state)?.templates())
}

fn chosen(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.noFile",
            "Please choose where to save the file.",
        )));
    }
    Ok(path)
}

/// Every image a definition uses must be kept here before it is saved.
fn images_kept(def: &TemplateDefinition, store: &TemplateStore) -> Result<(), AppError> {
    if def.assets.iter().all(|a| store.has(a)) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(UserMessage::new(
            "presentation.templateImageGone",
            "An image of this template is missing on this computer.",
        )))
    }
}

#[tauri::command(async)]
pub fn presentation_template_list(
    state: State<'_, AppState>,
) -> CommandResult<Vec<PresentationTemplateSummary>> {
    state.db(templates::list)
}

#[tauri::command(async)]
pub fn presentation_template_get(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<PresentationTemplate> {
    state.db(|conn| templates::get(conn, &id))
}

#[tauri::command(async)]
pub fn presentation_template_create(
    state: State<'_, AppState>,
    input: CreatePresentationTemplate,
) -> CommandResult<PresentationTemplate> {
    images_kept(&input.definition, &kept(&state)?)?;
    state.db(|conn| templates::create(conn, &input))
}

#[tauri::command(async)]
pub fn presentation_template_update(
    state: State<'_, AppState>,
    input: UpdatePresentationTemplate,
) -> CommandResult<PresentationTemplate> {
    if let Some(def) = &input.definition {
        images_kept(def, &kept(&state)?)?;
    }
    state.db(|conn| templates::update(conn, &input))
}

#[tauri::command(async)]
pub fn presentation_template_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| templates::delete(conn, &id))
}

/// Keeps an image the person chose (a logo, a background) for a template.
#[tauri::command(async)]
pub fn presentation_template_asset_add(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<TemplateAsset> {
    let path = PathBuf::from(path.trim());
    Ok(kept(&state)?.add_file(&path)?)
}

/// A kept template image, as a data: address (for previews).
#[tauri::command(async)]
pub fn presentation_template_asset(
    state: State<'_, AppState>,
    asset: TemplateAsset,
) -> CommandResult<String> {
    if !template_store::is_asset_id(&asset.id) {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.imageGone",
            "This image is not available on this computer.",
        ))
        .into());
    }
    let bytes = kept(&state)?.read(&asset).ok_or_else(|| {
        AppError::InvalidInput(UserMessage::new(
            "presentation.imageGone",
            "This image is not available on this computer.",
        ))
    })?;
    Ok(format!(
        "data:{};base64,{}",
        asset.media_type,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTemplate {
    pub id: String,
    pub path: String,
}

/// Saves a template with its images as one file (fonts are named, never included).
#[tauri::command(async)]
pub fn presentation_template_export(
    state: State<'_, AppState>,
    input: ExportTemplate,
) -> CommandResult<()> {
    let mut path = chosen(&input.path)?;
    if path.extension().is_none() {
        path.set_extension("awtemplate");
    }
    let store = kept(&state)?;
    let t = state.db(|conn| templates::get(conn, &input.id))?;
    let text = template_store::package(&t.name, &t.description, &t.definition, &store)?;
    write_atomically(&path, text.as_bytes())?;
    Ok(())
}

/// Adds a template from a file saved by another Abiding Word installation.
#[tauri::command(async)]
pub fn presentation_template_import_package(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<PresentationTemplate> {
    let path = PathBuf::from(path.trim());
    let text = std::fs::read_to_string(&path).map_err(|e| AppError::filesystem(&path, e))?;
    let package = template_store::unpack(&text, &kept(&state)?)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string);
    state.db(|conn| {
        templates::create(
            conn,
            &CreatePresentationTemplate {
                name: package.name.clone(),
                description: package.description.clone(),
                definition: package.definition.clone(),
                source_format: "package".into(),
                source_name: name.clone(),
                report: None,
            },
        )
    })
}

/// A PowerPoint file larger than this is not read (bytes).
const PPTX_MAX: u64 = 400 * 1024 * 1024;

/// How far a PowerPoint import is: real counts of layouts read, never an estimate.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    done: usize,
    total: usize,
}

/// Reads the design of a PowerPoint file (also one saved from Keynote,
/// Google Slides or LibreOffice) for the person to review. Its images are
/// kept; nothing is saved as a template until the person accepts it.
#[tauri::command(async)]
pub fn presentation_template_import_pptx(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<ImportedTemplate> {
    let path = PathBuf::from(path.trim());
    let size = std::fs::metadata(&path)
        .map_err(|e| AppError::filesystem(&path, e))?
        .len();
    if size > PPTX_MAX {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.templateFileLarge",
            "This file is too large to read as a template.",
        ))
        .into());
    }
    let bytes = std::fs::read(&path).map_err(|e| AppError::filesystem(&path, e))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let store = kept(&state)?;
    let progress = |done: usize, total: usize| {
        let _ = app.emit(
            "presentation-template-import-progress",
            ImportProgress { done, total },
        );
    };
    Ok(pptx_import::import(
        &bytes,
        &file_name,
        &store,
        font_catalog::system(),
        &progress,
    )?)
}

/// The fonts installed on this computer, to choose a replacement from.
#[tauri::command(async)]
pub fn presentation_fonts() -> CommandResult<Vec<InstalledFont>> {
    Ok(font_catalog::installed(font_catalog::system()))
}
