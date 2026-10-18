//! Presentation & Delivery (v0.18): presentations of a teaching, their
//! document, the audience screen and the exports. Exports are written only
//! to the file the person chose in the system's save dialog; nothing is
//! sent anywhere and the teaching is never changed.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::CommandResult;
use crate::assistant::http::Transport as _;
use crate::assistant::images as found_images;
use crate::db::{presentations, teaching};
use crate::domain::{
    CreatePresentation, CreatePresentationItem, Presentation, PresentationSummary, Reorder,
    UpdatePresentation, UpdatePresentationItem,
};
use crate::error::{AppError, UserMessage};
use crate::presentation::fonts::FontSet;
use crate::presentation::{
    document, images, markdown, package, pdf, pptx, AudienceDocument, AudienceState, ExportOptions,
    ImageStore, PresentationDocument,
};
use crate::state::AppState;

/// The label of the audience screen's window.
pub const AUDIENCE_WINDOW: &str = "audience";
pub const AUDIENCE_EVENT: &str = "presentation-audience";
pub const AUDIENCE_CLOSED_EVENT: &str = "presentation-audience-closed";

fn store(state: &AppState) -> Result<ImageStore, crate::error::ErrorPayload> {
    let dirs = &state.core()?.dirs;
    Ok(ImageStore {
        generated_dir: dirs.teaching_images(),
        offline_dir: dirs.presentation_images(),
    })
}

#[tauri::command(async)]
pub fn presentation_list(
    state: State<'_, AppState>,
    preparation_id: String,
) -> CommandResult<Vec<PresentationSummary>> {
    state.db(|conn| presentations::list(conn, &preparation_id))
}

#[tauri::command(async)]
pub fn presentation_get(state: State<'_, AppState>, id: String) -> CommandResult<Presentation> {
    state.db(|conn| presentations::get(conn, &id))
}

#[tauri::command(async)]
pub fn presentation_create(
    state: State<'_, AppState>,
    input: CreatePresentation,
) -> CommandResult<Presentation> {
    state.db(|conn| presentations::create(conn, &input))
}

#[tauri::command(async)]
pub fn presentation_update(
    state: State<'_, AppState>,
    input: UpdatePresentation,
) -> CommandResult<Presentation> {
    state.db(|conn| presentations::update(conn, &input))
}

#[tauri::command(async)]
pub fn presentation_delete(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.db(|conn| presentations::delete(conn, &id))
}

#[tauri::command(async)]
pub fn presentation_item_create(
    state: State<'_, AppState>,
    input: CreatePresentationItem,
) -> CommandResult<Presentation> {
    state.db(|conn| presentations::create_item(conn, &input))
}

#[tauri::command(async)]
pub fn presentation_item_update(
    state: State<'_, AppState>,
    input: UpdatePresentationItem,
) -> CommandResult<Presentation> {
    state.db(|conn| presentations::update_item(conn, &input))
}

#[tauri::command(async)]
pub fn presentation_item_delete(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<Presentation> {
    state.db(|conn| presentations::delete_item(conn, &id))
}

#[tauri::command(async)]
pub fn presentation_item_reorder(
    state: State<'_, AppState>,
    input: Reorder,
) -> CommandResult<Presentation> {
    state.db(|conn| presentations::reorder_items(conn, &input))
}

/// The presentation as it is now, for the editor and the Presenter View.
#[tauri::command(async)]
pub fn presentation_document(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<PresentationDocument> {
    let store = store(&state)?;
    state.db(|conn| document::build(conn, &id, &store))
}

/// What the audience screen may show: audience content only.
#[tauri::command(async)]
pub fn presentation_audience(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<AudienceDocument> {
    let store = store(&state)?;
    state.db(|conn| Ok(document::build(conn, &id, &store)?.audience()))
}

fn image_gone() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "presentation.imageGone",
        "This image is not available on this computer.",
    ))
}

/// A presentation's image, from its local copy, as a data: address.
#[tauri::command(async)]
pub fn presentation_image(
    state: State<'_, AppState>,
    id: String,
    asset_id: String,
) -> CommandResult<String> {
    let store = store(&state)?;
    let path = state.db(|conn| {
        let p = presentations::get(conn, &id)?;
        let prep = teaching::get(conn, &p.preparation_id)?;
        let material = prep
            .materials
            .iter()
            .find(|m| m.id == asset_id)
            .ok_or_else(image_gone)?;
        store.path_for(material).ok_or_else(image_gone)
    })?;
    let (bytes, header) = images::read_file(&path).ok_or_else(image_gone)?;
    use base64::Engine as _;
    Ok(format!(
        "data:{};base64,{}",
        header.media_type,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImage {
    pub presentation_id: String,
    pub asset_id: String,
}

/// Saves a copy of a found image (from Wikimedia Commons) on this computer,
/// so the presentation needs no internet. Only on the person's request.
#[tauri::command]
pub async fn presentation_image_save(
    state: State<'_, AppState>,
    input: SaveImage,
) -> CommandResult<()> {
    let store = store(&state)?;
    let (urls, target) = state.db(|conn| {
        let p = presentations::get(conn, &input.presentation_id)?;
        let prep = teaching::get(conn, &p.preparation_id)?;
        let material = prep
            .materials
            .iter()
            .find(|m| m.id == input.asset_id && m.kind == "image")
            .ok_or_else(image_gone)?;
        let info = material.image.clone().unwrap_or_default();
        let url = info.url.clone().ok_or_else(image_gone)?;
        Ok((offline_candidates(&info), store.offline_path(&url)))
    })?;
    let transport = state.transport()?;
    for url in urls {
        let Ok(call) = found_images::thumb_call(&url) else {
            continue;
        };
        let Ok(reply) = transport.send(call).await else {
            continue;
        };
        if (200..300).contains(&reply.status)
            && reply.body.len() <= 25_000_000
            && images::header(&reply.body).is_some()
        {
            write_atomically(&target, &reply.body)?;
            return Ok(());
        }
    }
    Err(AppError::InvalidInput(UserMessage::new(
        "presentation.imageSaveFailed",
        "The image could not be saved. Check the internet connection and try again.",
    ))
    .into())
}

/// A large Wikimedia preview (1600 pixels wide) first, then the small
/// preview: only Wikimedia's image servers, never the full original file.
fn offline_candidates(info: &crate::domain::ImageInfo) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(thumb) = info.thumb_url.as_deref() {
        if let Some(at) = thumb.rfind("px-") {
            let start = thumb[..at].rfind('/').map_or(at, |s| s + 1);
            if thumb[start..at].chars().all(|c| c.is_ascii_digit()) {
                out.push(format!("{}1600{}", &thumb[..start], &thumb[at..]));
            }
        }
    }
    // The original file can be very large: only Commons previews are fetched.
    out.extend(info.thumb_url.clone());
    out.retain(|u| found_images::is_commons_file(u));
    out.dedup();
    out
}

fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::filesystem(dir, e))?;
    }
    let mut name = target
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".abidingword-part");
    let temp = target.with_file_name(name);
    let written = (|| {
        use std::io::Write as _;
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::filesystem(&temp, e));
    }
    std::fs::rename(&temp, target).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        AppError::filesystem(target, e)
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPresentation {
    pub id: String,
    /// pptx, pdf, speaker_pdf, markdown or package.
    pub format: String,
    /// The file the person chose in the save dialog.
    pub path: String,
    #[serde(default)]
    pub options: ExportOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub slides: usize,
    /// Images that could not be included (no copy on this computer).
    pub missing_images: usize,
}

/// The extension a format's file has.
pub fn extension(format: &str) -> Option<&'static str> {
    Some(match format {
        "pptx" => "pptx",
        "pdf" | "speaker_pdf" => "pdf",
        "markdown" => "md",
        "package" => "json",
        _ => return None,
    })
}

/// The file's content for an export, from the one document.
pub fn render(
    doc: &PresentationDocument,
    format: &str,
    options: &ExportOptions,
    fonts: impl FnOnce() -> FontSet,
) -> Result<Vec<u8>, AppError> {
    let images = pdf::image_data(doc);
    Ok(match format {
        "pptx" => pptx::render(doc, &images, &fonts(), options)?,
        "pdf" => pdf::slides(doc, &images, &fonts(), options)?,
        "speaker_pdf" => pdf::speaker(doc, &images, &fonts(), options)?,
        "markdown" => markdown::render(doc, options).into_bytes(),
        "package" => package::to_json(doc)?.into_bytes(),
        other => {
            return Err(AppError::InvalidInput(
                UserMessage::new(
                    "invalidChoice",
                    format!("“{other}” is not an export format."),
                )
                .with("value", other),
            ))
        }
    })
}

/// Writes an export to the chosen file (replacing it only after the save
/// dialog asked, and only once the new file is complete).
#[tauri::command(async)]
pub fn presentation_export(
    state: State<'_, AppState>,
    input: ExportPresentation,
) -> CommandResult<ExportResult> {
    let ext = extension(&input.format).ok_or_else(|| {
        AppError::InvalidInput(UserMessage::new("invalidChoice", "Unknown export format."))
    })?;
    let mut path = PathBuf::from(input.path.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.noFile",
            "Please choose where to save the file.",
        ))
        .into());
    }
    let has_ext = path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        e.eq_ignore_ascii_case(ext) || (ext == "md" && e.eq_ignore_ascii_case("markdown"))
    });
    if !has_ext {
        let mut name = path
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(format!(".{ext}"));
        path.set_file_name(name);
    }
    let store = store(&state)?;
    let doc = state.db(|conn| package::build(conn, &input.id, &store))?;
    let bytes = render(&doc, &input.format, &input.options, FontSet::system)?;
    write_atomically(&path, &bytes)?;
    // Images shown as a placeholder: not on this computer, or of a kind this format cannot hold.
    let missing_images = doc
        .images
        .iter()
        .filter(|i| {
            let kind = i.media_type.as_deref().unwrap_or("");
            !i.available
                || (matches!(input.format.as_str(), "pdf" | "speaker_pdf")
                    && !matches!(kind, "image/png" | "image/jpeg"))
                || (input.format == "pptx" && kind == "image/webp")
        })
        .count();
    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        slides: doc.slides.len(),
        missing_images,
    })
}

// ---------------------------------------------------------------------------
// The audience screen: a second window, on another display when there is one
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screen {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

/// The displays connected to this computer.
#[tauri::command]
pub async fn presentation_screens(app: AppHandle) -> CommandResult<Vec<Screen>> {
    let monitors = app.available_monitors().map_err(window_error)?;
    let primary = app.primary_monitor().ok().flatten();
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| Screen {
            index,
            name: m.name().cloned().unwrap_or_default(),
            width: m.size().width,
            height: m.size().height,
            primary: primary
                .as_ref()
                .is_some_and(|p| p.position() == m.position() && p.size() == m.size()),
        })
        .collect())
}

fn window_error(e: tauri::Error) -> AppError {
    log::warn!("audience window: {e}");
    AppError::InvalidInput(UserMessage::new(
        "presentation.audienceFailed",
        "The audience screen could not be opened.",
    ))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAudience {
    pub presentation_id: String,
    /// The display to fill; the window opens normally when absent.
    pub screen: Option<usize>,
    pub title: String,
    pub state: AudienceState,
}

/// Opens (or moves) the audience screen's window.
#[tauri::command]
pub async fn presentation_audience_open(
    app: AppHandle,
    state: State<'_, AppState>,
    input: OpenAudience,
) -> CommandResult<()> {
    // The audience window may only show this presentation's audience content.
    let store = store(&state)?;
    state.db(|conn| document::build(conn, &input.presentation_id, &store).map(|_| ()))?;
    let mut shown = input.state.clone();
    shown.presentation_id = input.presentation_id.clone();
    shown.marks = shown.marks.bounded();
    state.set_audience(Some(shown.clone()))?;

    let id: String = input
        .presentation_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let window = match app.get_webview_window(AUDIENCE_WINDOW) {
        Some(window) => {
            // A window left from another presentation shows this one now.
            if let Ok(mut url) = window.url() {
                let wanted = format!("audience={id}");
                if url.query() != Some(wanted.as_str()) {
                    url.set_query(Some(&wanted));
                    window.navigate(url).map_err(window_error)?;
                }
            }
            let _ = window.set_title(input.title.trim());
            window
        }
        None => {
            let url = WebviewUrl::App(format!("index.html?audience={id}").into());
            let window = WebviewWindowBuilder::new(&app, AUDIENCE_WINDOW, url)
                .title(input.title.trim())
                // The presenter keeps the keyboard (and a clicker) on their own screen.
                .focused(false)
                .inner_size(960.0, 540.0)
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .build()
                .map_err(window_error)?;
            let handle = app.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(state) = handle.try_state::<AppState>() {
                        let _ = state.set_audience(None);
                    }
                    let _ = handle.emit_to("main", AUDIENCE_CLOSED_EVENT, ());
                }
            });
            window
        }
    };
    if let Some(index) = input.screen {
        let monitors = app.available_monitors().map_err(window_error)?;
        if let Some(monitor) = monitors.get(index) {
            let _ = window.set_fullscreen(false);
            window
                .set_position(*monitor.position())
                .map_err(window_error)?;
            window.set_fullscreen(true).map_err(window_error)?;
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    let _ = app.emit_to(AUDIENCE_WINDOW, AUDIENCE_EVENT, &shown);
    Ok(())
}

pub const AUDIENCE_KEY_EVENT: &str = "presentation-audience-key";

/// A key pressed on the audience screen (a clicker, or the keyboard when that
/// window has focus) is handed to the Presenter View, which moves the slides.
#[tauri::command]
pub async fn presentation_audience_key(app: AppHandle, key: String) -> CommandResult<()> {
    const KEYS: &[&str] = &[
        "ArrowRight",
        "ArrowDown",
        "PageDown",
        " ",
        "Enter",
        "ArrowLeft",
        "ArrowUp",
        "PageUp",
        "Backspace",
        "Home",
        "End",
        "b",
        "B",
        ".",
        "o",
        "O",
        "Escape",
    ];
    // Digits too: a number and Enter go to that slide.
    if KEYS.contains(&key.as_str()) || (key.len() == 1 && key.as_bytes()[0].is_ascii_digit()) {
        let _ = app.emit_to("main", AUDIENCE_KEY_EVENT, key);
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
    }
    Ok(())
}

/// Shows a slide, a pause or a passage on the audience screen.
#[tauri::command]
pub async fn presentation_audience_show(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AudienceState,
) -> CommandResult<()> {
    let input = AudienceState {
        marks: input.marks.bounded(),
        ..input
    };
    // Changes may be handled out of order: an older one never replaces a newer one.
    if !state.set_audience_if_newer(input.clone())? {
        return Ok(());
    }
    if app.get_webview_window(AUDIENCE_WINDOW).is_some() {
        let _ = app.emit_to(AUDIENCE_WINDOW, AUDIENCE_EVENT, &input);
    }
    Ok(())
}

/// What the audience screen should show now (when it opens or reloads).
#[tauri::command(async)]
pub fn presentation_audience_state(
    state: State<'_, AppState>,
) -> CommandResult<Option<AudienceState>> {
    state.audience()
}

#[tauri::command]
pub async fn presentation_audience_close(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    state.set_audience(None)?;
    if let Some(window) = app.get_webview_window(AUDIENCE_WINDOW) {
        window.close().map_err(window_error)?;
    }
    Ok(())
}
