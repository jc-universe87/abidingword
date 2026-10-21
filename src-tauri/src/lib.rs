//! Abiding Word native core.
//!
//! * `filesystem` — the local data directory
//! * `db`         — SQLite, migrations and repositories
//! * `domain`     — records, inputs and validation
//! * `commands`   — the typed API the frontend calls
//! * `state`      — startup and shared state

pub mod assistant;
pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod filesystem;
pub mod integrations;
pub mod library;
pub mod presentation;
pub mod scripture;
pub mod state;

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use crate::error::{AppError, AppResult};
use crate::filesystem::{DataDirs, DATA_DIR_ENV, DATA_DIR_NAME};
use crate::state::AppState;

const LOG_FILE_NAME: &str = "abiding-word";

/// Whether this build was configured with an updater (public key and
/// endpoint). The updater section is added only by the test-update workflow
/// (docs/updates.md); without it the plugin is not even registered.
pub fn updates_configured(app: &AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Closing the main window also closes a presentation's audience screen.
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                )
            {
                if let Some(audience) = window
                    .app_handle()
                    .get_webview_window(commands::presentations::AUDIENCE_WINDOW)
                {
                    let _ = audience.close();
                }
            }
        })
        .setup(|app| {
            if updates_configured(app.handle()) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
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
            commands::studies::study_duplicate,
            commands::studies::study_search,
            commands::sections::study_section_list,
            commands::sections::study_section_update,
            commands::sections::study_section_create,
            commands::sections::study_section_delete,
            commands::sections::study_section_reorder,
            commands::blocks::study_block_create,
            commands::blocks::study_block_update,
            commands::blocks::study_block_delete,
            commands::blocks::study_block_reorder,
            commands::findings::finding_list,
            commands::findings::finding_create,
            commands::findings::finding_update,
            commands::findings::finding_delete,
            commands::findings::finding_reorder,
            commands::findings::finding_link_passage,
            commands::findings::finding_unlink_passage,
            commands::findings::finding_set_tags,
            commands::relations::study_relation_list,
            commands::relations::study_relation_create,
            commands::relations::study_relation_delete,
            commands::templates::template_list,
            commands::templates::template_get,
            commands::templates::template_create,
            commands::templates::template_update,
            commands::templates::template_duplicate,
            commands::templates::template_delete,
            commands::library::library_list,
            commands::library::library_languages,
            commands::library::library_get_source,
            commands::library::library_import_preview,
            commands::library::library_import_commit,
            commands::library::library_import_cancel,
            commands::library::library_remove_source,
            commands::library::library_search,
            commands::library::library_open_segment,
            commands::library::library_original_info,
            commands::library::library_original_read,
            commands::library::library_source_contents,
            commands::library::library_generated_contents,
            commands::library::library_source_links,
            commands::library::library_epub_structure,
            commands::library::library_epub_item,
            commands::library::library_docx_structure,
            commands::library::library_docx_item,
            commands::library::source_get_segments,
            commands::library::source_get_passages,
            commands::library::library_passage_sources,
            commands::library::library_passage_source_locations,
            commands::library::library_source_references,
            commands::library::library_detect_references,
            commands::library::library_source_find,
            commands::library::source_segment_passage_links,
            commands::library::finding_source_add,
            commands::library::finding_create_from_source,
            commands::library::finding_source_locate,
            commands::library::finding_source_remove,
            commands::library::finding_source_list,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::scripture::scripture_books,
            commands::scripture::scripture_get_chapter,
            commands::scripture::scripture_get_passage,
            commands::scripture::scripture_search,
            commands::scripture::scripture_concordance,
            commands::scripture::scripture_reference_parse,
            commands::scripture::scripture_reference_detect,
            commands::bibles::bible_list,
            commands::bibles::bible_get,
            commands::bibles::bible_bundled_list,
            commands::bibles::bible_import_preview,
            commands::bibles::bible_import_commit,
            commands::bibles::bible_import_cancel,
            commands::bibles::bible_remove,
            commands::bibles::bible_set_language,
            commands::bibles::bible_language_options,
            commands::annotations::annotation_list,
            commands::annotations::annotation_marks_list,
            commands::annotations::annotation_create,
            commands::annotations::annotation_update,
            commands::annotations::annotation_delete,
            commands::annotations::annotation_anchor_check,
            commands::source_annotations::source_annotation_list,
            commands::source_annotations::source_annotation_create,
            commands::source_annotations::source_annotation_update,
            commands::source_annotations::source_annotation_delete,
            commands::source_annotations::source_marks_list,
            commands::source_annotations::source_marks_sources,
            commands::study_passages::study_passage_list,
            commands::study_passages::study_passage_add,
            commands::study_passages::study_passage_remove,
            commands::study_passages::study_passage_set_role,
            commands::teaching::teaching_list,
            commands::teaching::teaching_get,
            commands::teaching::teaching_create,
            commands::teaching::teaching_update,
            commands::teaching::teaching_delete,
            commands::teaching::teaching_point_create,
            commands::teaching::teaching_point_update,
            commands::teaching::teaching_point_delete,
            commands::teaching::teaching_point_reorder,
            commands::teaching::teaching_finding_link,
            commands::teaching::teaching_finding_unlink,
            commands::teaching::teaching_passage_add,
            commands::teaching::teaching_passage_remove,
            commands::teaching::teaching_material_keep,
            commands::teaching::teaching_material_remove,
            commands::teaching::teaching_image,
            commands::presentation_templates::presentation_template_list,
            commands::presentation_templates::presentation_template_get,
            commands::presentation_templates::presentation_template_create,
            commands::presentation_templates::presentation_template_update,
            commands::presentation_templates::presentation_template_delete,
            commands::presentation_templates::presentation_template_asset_add,
            commands::presentation_templates::presentation_template_asset,
            commands::presentation_templates::presentation_template_export,
            commands::presentation_templates::presentation_template_import_package,
            commands::presentation_templates::presentation_template_import_pptx,
            commands::presentation_templates::presentation_template_preview,
            commands::presentation_templates::presentation_fonts,
            commands::presentations::presentation_list,
            commands::presentations::presentation_get,
            commands::presentations::presentation_create,
            commands::presentations::presentation_update,
            commands::presentations::presentation_delete,
            commands::presentations::presentation_item_create,
            commands::presentations::presentation_item_update,
            commands::presentations::presentation_item_delete,
            commands::presentations::presentation_item_reorder,
            commands::presentations::presentation_document,
            commands::presentations::presentation_audience,
            commands::presentations::presentation_layout,
            commands::presentations::presentation_image,
            commands::presentations::presentation_image_save,
            commands::presentations::presentation_export,
            commands::materials::material_save_markdown,
            commands::presentations::presentation_screens,
            commands::presentations::presentation_audience_open,
            commands::presentations::presentation_audience_show,
            commands::presentations::presentation_audience_state,
            commands::presentations::presentation_audience_close,
            commands::presentations::presentation_audience_key,
            commands::assistant::assistant_settings_get,
            commands::assistant::assistant_settings_set,
            commands::assistant::assistant_key_set,
            commands::assistant::assistant_test,
            commands::assistant::assistant_search_test,
            commands::assistant::assistant_preview,
            commands::assistant::assistant_ask,
            commands::assistant::assistant_find_images,
            commands::assistant::assistant_image_preview,
            commands::assistant::assistant_generate_image,
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
    AppState::start(dirs, log_dir, app.path().resource_dir().ok())
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
