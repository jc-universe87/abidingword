//! Teaching materials (v0.18.6): a manuscript, a question sheet or a
//! worksheet, put together by the interface from the person's own teaching.
//! The core only writes the Markdown the person asked to save, to the file
//! they chose in the system's save dialog; nothing is sent anywhere and the
//! teaching is never changed.

use std::path::PathBuf;

use serde::Deserialize;

use super::presentations::write_atomically;
use super::CommandResult;
use crate::error::{AppError, UserMessage};

/// Far beyond any teaching; a guard against a runaway call, not a limit anyone meets.
const MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMaterial {
    pub path: String,
    pub text: String,
}

/// The chosen file, always ending in .md (or a .markdown the person typed).
fn markdown_path(raw: &str) -> Result<PathBuf, AppError> {
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
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"));
    if !has_ext {
        let mut name = path
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(".md");
        path.set_file_name(name);
    }
    Ok(path)
}

/// Saves a material as Markdown (replacing a file only after the save dialog
/// asked, and only once the new file is complete). Returns where it went.
#[tauri::command(async)]
pub fn material_save_markdown(input: SaveMaterial) -> CommandResult<String> {
    if input.text.len() > MAX_BYTES {
        return Err(AppError::InvalidInput(UserMessage::new(
            "material.tooLong",
            "This is too long to save as one file.",
        ))
        .into());
    }
    let path = markdown_path(&input.path)?;
    write_atomically(&path, input.text.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
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
}
