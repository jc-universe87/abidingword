//! Bible management: list, import (preview → commit), remove.
//!
//! File ownership: when the user imports files, Abiding Word copies them
//! into `sources/bibles/<translation id>/` and reads only its own copy from
//! then on. Removing the Bible deletes that copy. The user's original files
//! are never modified, moved or deleted. Bundled Bibles are read from the
//! app's resources and have no copy.

use std::path::PathBuf;

use tauri::State;

use super::CommandResult;
use crate::db::bibles::{self, SourceRecord};
use crate::error::{AppError, ErrorPayload, UserMessage};
use crate::filesystem;
use crate::scripture::bundled::{self, BUNDLED};
use crate::scripture::import::{self, ImportOrigin, ImportPreview, SuggestedMetadata, WordReport};
use crate::scripture::{
    BibleTranslation, BundledBibleInfo, CommitImport, ImportRequest, WordAnnotations, WordChoice,
};
use crate::state::AppState;

#[tauri::command(async)]
pub fn bible_list(state: State<'_, AppState>) -> CommandResult<Vec<BibleTranslation>> {
    state.db(bibles::list)
}

#[tauri::command(async)]
pub fn bible_get(state: State<'_, AppState>, id: String) -> CommandResult<BibleTranslation> {
    state.db(|conn| bibles::get(conn, &id))
}

/// Bibles shipped with the app, and whether each is already added.
#[tauri::command(async)]
pub fn bible_bundled_list(state: State<'_, AppState>) -> CommandResult<Vec<BundledBibleInfo>> {
    state.db(|conn| {
        BUNDLED
            .iter()
            .map(|b| {
                Ok(BundledBibleInfo {
                    id: b.id,
                    name: b.name,
                    short_name: b.short_name,
                    language: b.language,
                    language_code: b.language_code,
                    license_type: b.license_type,
                    installed: bibles::find_builtin(conn, &bundled_resource_name(b.resource))?
                        .is_some(),
                })
            })
            .collect()
    })
}

fn bundled_resource_name(file: &str) -> String {
    format!("scripture/{file}")
}

/// Reads and checks the chosen files (or a bundled Bible) and returns what
/// the verification screen shows. Nothing is saved yet.
#[tauri::command(async)]
pub fn bible_import_preview(
    state: State<'_, AppState>,
    input: ImportRequest,
) -> CommandResult<ImportPreview> {
    state.core()?;
    let (paths, origin, suggested) = match input.bundled.as_deref() {
        Some(id) => {
            let bible = bundled::by_id(id).ok_or_else(|| AppError::not_found("Bible", id))?;
            let dir = state
                .resource_dir()
                .ok_or_else(|| AppError::Unexpected("resource directory unavailable".into()))?;
            let path = dir.join(bundled_resource_name(bible.resource));
            let suggested = SuggestedMetadata {
                name: bible.name.into(),
                short_name: bible.short_name.into(),
                language: bible.language.into(),
                language_code: bible.language_code.into(),
                publisher: Some(bible.publisher.into()),
                copyright_notice: Some(bible.copyright_notice.into()),
                license_type: Some(bible.license_type.into()),
            };
            (
                vec![path],
                ImportOrigin::Bundled { id: bible.id },
                suggested,
            )
        }
        None => {
            let paths: Vec<PathBuf> = input.paths.iter().map(PathBuf::from).collect();
            (paths, ImportOrigin::UserFiles, SuggestedMetadata::default())
        }
    };
    let staged = import::stage(&paths, origin)?;
    let suggested = SuggestedMetadata {
        name: if suggested.name.is_empty() {
            staged.suggested_name.clone()
        } else {
            suggested.name
        },
        ..suggested
    };
    let preview = staged.preview(suggested);
    *state.pending_import()? = Some(staged);
    Ok(preview)
}

/// Saves the previewed Bible. On any failure nothing is saved and the
/// preview stays available, so the user can correct the details and retry.
#[tauri::command(async)]
pub fn bible_import_commit(
    state: State<'_, AppState>,
    input: CommitImport,
) -> CommandResult<BibleTranslation> {
    let core = state.core()?;
    let mut pending = state.pending_import()?;
    let staged = pending
        .as_ref()
        .filter(|s| s.id == input.preview_id)
        .ok_or_else(|| {
            AppError::InvalidInput(UserMessage::new(
                "import.expired",
                "This import has expired. Please choose the files again.",
            ))
        })?;

    let id = bibles::new_translation_id();
    let names = staged
        .files
        .iter()
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect::<Vec<_>>()
        .join(", ");
    let (source, copy_dir) = match &staged.origin {
        ImportOrigin::Bundled { id: bundled_id } => {
            let bible = bundled::by_id(bundled_id)
                .ok_or_else(|| AppError::not_found("Bible", *bundled_id))?;
            (
                SourceRecord {
                    origin: "bundled",
                    path: Some(bundled_resource_name(bible.resource)),
                    original_file_name: Some(bible.resource.into()),
                    format: staged.format,
                    is_builtin: true,
                },
                None,
            )
        }
        ImportOrigin::Existing { .. } => {
            return Err(AppError::InvalidInput(UserMessage::new(
                "import.expired",
                "This import has expired. Please choose the files again.",
            ))
            .into())
        }
        ImportOrigin::UserFiles => {
            let dir = core.dirs.bible_sources(&id);
            filesystem::copy_into(&staged.files, &dir)?;
            (
                SourceRecord {
                    origin: "managed_copy",
                    path: Some(format!("sources/bibles/{id}")),
                    original_file_name: Some(names),
                    format: staged.format,
                    is_builtin: false,
                },
                Some(dir),
            )
        }
    };

    let result = core
        .db
        .with_conn(|conn| bibles::commit_import(conn, &id, &staged.content, &input, &source));
    match result {
        Ok(translation) => {
            *pending = None;
            Ok(translation)
        }
        Err(error) => {
            if let Some(dir) = copy_dir {
                filesystem::remove_managed(&dir);
            }
            Err(ErrorPayload::from(error))
        }
    }
}

#[tauri::command(async)]
pub fn bible_import_cancel(state: State<'_, AppState>, preview_id: String) -> CommandResult<()> {
    let mut pending = state.pending_import()?;
    if pending.as_ref().is_some_and(|s| s.id == preview_id) {
        *pending = None;
    }
    Ok(())
}

/// Removes a Bible's text and Abiding Word's copy of its files. Study
/// passages, notes and other translation-independent data stay.
#[tauri::command(async)]
pub fn bible_remove(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    let core = state.core()?;
    let removed = core.db.with_conn(|conn| bibles::remove(conn, &id))?;
    if removed.source_origin == "managed_copy" {
        filesystem::remove_managed(&core.dirs.bible_sources(&removed.id));
    }
    Ok(())
}

/// Corrects the language of an installed Bible (v0.18.3): the name shown and
/// the tag typed references use first. Nothing else changes.
#[tauri::command(async)]
pub fn bible_set_language(
    state: State<'_, AppState>,
    id: String,
    language: String,
    language_code: Option<String>,
) -> CommandResult<BibleTranslation> {
    let core = state.core()?;
    Ok(core
        .db
        .with_conn(|conn| bibles::set_language(conn, &id, &language, language_code.as_deref()))?)
}

/// One language a Bible can be marked as: the 100 reference languages.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibleLanguageOption {
    pub code: &'static str,
    /// English name ("Polish").
    pub name: &'static str,
    /// The name in the language itself, when known ("polski").
    pub native: Option<&'static str>,
}

/// The languages offered when a Bible's language is chosen, by speakers.
#[tauri::command]
pub fn bible_language_options() -> Vec<BibleLanguageOption> {
    crate::scripture::data_packs::listed()
        .iter()
        .map(|l| BibleLanguageOption {
            code: l.code,
            name: l.name,
            native: l.native,
        })
        .collect()
}

/// What reading an installed Bible's kept files again found in its words
/// (v0.22), for Settings → Bibles.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordsPreview {
    pub preview_id: String,
    pub translation_id: String,
    pub format: &'static str,
    pub words: WordReport,
    /// The word index the Bible has now, if any.
    pub current: Option<WordAnnotations>,
}

/// The files a Bible was added from, as Abiding Word keeps them: its managed
/// copy, or the bundled resource.
fn kept_files(
    state: &AppState,
    translation: &BibleTranslation,
) -> Result<Vec<PathBuf>, ErrorPayload> {
    let missing = || {
        ErrorPayload::from(AppError::InvalidInput(UserMessage::new(
            "words.noSource",
            "The files this Bible was added from are no longer kept, so its words cannot be read again. Remove the Bible and add it again to get them.",
        )))
    };
    let core = state.core()?;
    let files: Vec<PathBuf> = match translation.source_origin.as_str() {
        "bundled" => {
            let path = translation.source_path.as_deref().unwrap_or_default();
            // Only a name this app gives a bundled Bible.
            let known = BUNDLED
                .iter()
                .any(|b| bundled_resource_name(b.resource) == path);
            let dir = state.resource_dir().ok_or_else(missing)?;
            if !known {
                return Err(missing());
            }
            vec![dir.join(path)]
        }
        _ => {
            let dir = core.dirs.bible_sources(&translation.id);
            let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
                .map_err(|_| missing())?
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                .map(|e| e.path())
                .collect();
            files.sort();
            files
        }
    };
    if files.is_empty() || files.iter().any(|f| !f.is_file()) {
        return Err(missing());
    }
    Ok(files)
}

/// Reads an installed Bible's kept files again for their words (v0.22).
/// Nothing is saved yet; the text must be exactly the Bible's own.
#[tauri::command(async)]
pub fn bible_words_preview(state: State<'_, AppState>, id: String) -> CommandResult<WordsPreview> {
    let core = state.core()?;
    let translation = core.db.with_conn(|conn| bibles::get(conn, &id))?;
    let files = kept_files(&state, &translation)?;
    let staged = import::stage(
        &files,
        ImportOrigin::Existing {
            translation_id: id.clone(),
        },
    )?;
    if staged.content.has_errors() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "words.textDiffers",
            "The kept files no longer give exactly this Bible's text, so its words cannot be added. Remove the Bible and add it again to get them.",
        ))
        .into());
    }
    core.db
        .with_conn(|conn| crate::db::bible_words::check_same_text(conn, &id, &staged.content))?;
    let preview = WordsPreview {
        preview_id: staged.id.clone(),
        translation_id: id,
        format: staged.format,
        words: staged.content.words.report.clone(),
        current: translation.words,
    };
    *state.pending_import()? = Some(staged);
    Ok(preview)
}

/// Saves the word index read by [`bible_words_preview`], replacing the old
/// one in one transaction. The Bible's text and everything else stay.
#[tauri::command(async)]
pub fn bible_words_apply(
    state: State<'_, AppState>,
    preview_id: String,
    words: WordChoice,
) -> CommandResult<BibleTranslation> {
    let core = state.core()?;
    let mut pending = state.pending_import()?;
    let staged = pending
        .as_ref()
        .filter(|s| s.id == preview_id)
        .ok_or_else(|| {
            AppError::InvalidInput(UserMessage::new(
                "import.expired",
                "This import has expired. Please choose the files again.",
            ))
        })?;
    let ImportOrigin::Existing { translation_id } = &staged.origin else {
        return Err(AppError::InvalidInput(UserMessage::new(
            "import.expired",
            "This import has expired. Please choose the files again.",
        ))
        .into());
    };
    let translation_id = translation_id.clone();
    core.db.with_conn(|conn| {
        crate::db::bible_words::replace(
            conn,
            &translation_id,
            &staged.content,
            staged.format,
            &words,
        )
    })?;
    *pending = None;
    Ok(core
        .db
        .with_conn(|conn| bibles::get(conn, &translation_id))?)
}

/// Removes an installed Bible's word index (v0.22). Its text stays; the
/// ordinary concordance is unaffected.
#[tauri::command(async)]
pub fn bible_words_remove(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<BibleTranslation> {
    let core = state.core()?;
    Ok(core.db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        crate::db::bible_words::remove(&tx, &id)?;
        tx.commit()?;
        bibles::get(conn, &id)
    })?)
}
