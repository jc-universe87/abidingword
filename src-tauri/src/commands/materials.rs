//! Teaching materials (v0.18.6): a manuscript, a question sheet or a
//! worksheet, put together by the interface from the person's own teaching.
//! The core only writes the Markdown the person asked to save, to the file
//! they chose in the system's save dialog; nothing is sent anywhere and the
//! teaching is never changed.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;

use super::presentations::write_atomically;
use super::CommandResult;
use crate::db::bibles::{self, MaterialScripture};
use crate::error::{AppError, UserMessage};
use crate::materials::docx;
use crate::scripture::reference::ScriptureRef;
use crate::state::AppState;

/// At most this many passages in one material: a teaching names a few.
const MAX_PASSAGES: usize = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialScriptureInput {
    pub translation_id: String,
    /// Canonical references, in the order the material shows them.
    pub references: Vec<String>,
}

/// The text of a material's passages from the Bible the person chose
/// (v0.18.8), with any verse that Bible lacks named. Only that Bible is
/// read; nothing is fetched and the text never leaves this computer.
#[tauri::command(async)]
pub fn material_scripture(
    state: State<'_, AppState>,
    input: MaterialScriptureInput,
) -> CommandResult<MaterialScripture> {
    if input.references.len() > MAX_PASSAGES {
        return Err(AppError::InvalidInput(UserMessage::new(
            "material.tooManyPassages",
            "This material names too many passages to include their text.",
        ))
        .into());
    }
    let references = input
        .references
        .iter()
        .map(|r| ScriptureRef::from_canonical(r))
        .collect::<Result<Vec<_>, _>>()?;
    state.db(|conn| bibles::material_passages(conn, &input.translation_id, &references))
}

/// Far beyond any teaching; a guard against a runaway call, not a limit anyone meets.
const MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMaterial {
    pub path: String,
    pub text: String,
}

/// The chosen file, always ending in one of the format's extensions (the
/// first is added when it has none of them).
fn chosen_path(raw: &str, extensions: &[&str]) -> Result<PathBuf, AppError> {
    let mut path = PathBuf::from(raw.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.noFile",
            "Please choose where to save the file.",
        )));
    }
    let has_ext = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| extensions.iter().any(|x| e.eq_ignore_ascii_case(x)));
    if !has_ext {
        let mut name = path
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(format!(".{}", extensions[0]));
        path.set_file_name(name);
    }
    Ok(path)
}

fn markdown_path(raw: &str) -> Result<PathBuf, AppError> {
    chosen_path(raw, &["md", "markdown"])
}

/// Writes the file the save dialog named, replacing it only because the
/// dialog asked; a file reached only by adding the extension to that name
/// was never asked about, so it is not replaced. The new file is complete
/// before it takes the old one's place, and nothing is left behind.
fn save_chosen(raw: &str, path: PathBuf, bytes: &[u8]) -> Result<String, AppError> {
    if path != std::path::Path::new(raw.trim()) && path.exists() {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "presentation.fileExists",
                format!("A file named “{name}” already exists. Please choose another name."),
            )
            .with("name", name),
        ));
    }
    write_atomically(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

fn too_long() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "material.tooLong",
        "This is too long to save as one file.",
    ))
}

/// Saves a material as Markdown (replacing a file only after the save dialog
/// asked, and only once the new file is complete). Returns where it went.
#[tauri::command(async)]
pub fn material_save_markdown(input: SaveMaterial) -> CommandResult<String> {
    if input.text.len() > MAX_BYTES {
        return Err(too_long().into());
    }
    let path = markdown_path(&input.path)?;
    Ok(save_chosen(&input.path, path, input.text.as_bytes())?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMaterialDocx {
    pub path: String,
    /// The material as the interface put it together (the same one the
    /// preview, the printed page and the Markdown show).
    pub document: docx::MaterialDocument,
}

/// Saves a material as a Word document (.docx), by the same rules as the
/// Markdown file. Returns where it went.
#[tauri::command(async)]
pub fn material_save_docx(input: SaveMaterialDocx) -> CommandResult<String> {
    let bytes = docx::render(&input.document)?;
    if bytes.len() > MAX_BYTES {
        return Err(too_long().into());
    }
    let path = chosen_path(&input.path, &["docx"])?;
    Ok(save_chosen(&input.path, path, &bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn absolute(name: &str) -> String {
        std::env::temp_dir()
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn a_chosen_file_always_ends_in_md() {
        assert_eq!(
            markdown_path(&absolute("Sermon"))
                .unwrap()
                .extension()
                .unwrap(),
            "md"
        );
        assert_eq!(
            markdown_path(&absolute("Sermon.MD"))
                .unwrap()
                .file_name()
                .unwrap(),
            "Sermon.MD"
        );
        assert_eq!(
            markdown_path(&absolute("Notes.markdown"))
                .unwrap()
                .file_name()
                .unwrap(),
            "Notes.markdown"
        );
        // A name with another extension keeps it and gets .md after it.
        assert_eq!(
            markdown_path(&absolute("Sermon.pdf"))
                .unwrap()
                .file_name()
                .unwrap(),
            "Sermon.pdf.md"
        );
    }

    #[test]
    fn no_file_or_a_relative_one_is_refused() {
        assert!(markdown_path("").is_err());
        assert!(markdown_path("   ").is_err());
        assert!(markdown_path("relative/notes.md").is_err());
    }

    #[test]
    fn saves_the_text_exactly_and_refuses_a_runaway_one() {
        let dir = std::env::temp_dir().join(format!("aw-material-{}", std::process::id()));
        let target = dir.join("Leader guide");
        let text = "# Remain in the vine\n\n1. What does “remain” mean?\n";
        let saved = material_save_markdown(SaveMaterial {
            path: target.to_string_lossy().into_owned(),
            text: text.into(),
        })
        .unwrap();
        assert!(saved.ends_with("Leader guide.md"));
        assert_eq!(std::fs::read_to_string(&saved).unwrap(), text);
        assert!(material_save_markdown(SaveMaterial {
            path: target.to_string_lossy().into_owned(),
            text: "x".repeat(MAX_BYTES + 1),
        })
        .is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn never_replaces_a_file_the_save_dialog_did_not_ask_about() {
        let dir = std::env::temp_dir().join(format!("aw-material-ask-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let existing = dir.join("Sermon.txt.md");
        std::fs::write(&existing, "kept").unwrap();
        // The dialog named "Sermon.txt"; ".md" is added, and that file is someone else's.
        assert!(material_save_markdown(SaveMaterial {
            path: dir.join("Sermon.txt").to_string_lossy().into_owned(),
            text: "new".into(),
        })
        .is_err());
        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "kept");
        // The very file the dialog named (and asked about) is replaced.
        material_save_markdown(SaveMaterial {
            path: existing.to_string_lossy().into_owned(),
            text: "new".into(),
        })
        .unwrap();
        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "new");
        let _ = std::fs::remove_dir_all(dir);
    }
}
