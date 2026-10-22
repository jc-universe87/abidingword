//! The local data directory.
//!
//! Everything the user owns lives under one folder, so it can be found,
//! backed up and moved as a unit:
//!
//! ```text
//! Abiding Word/
//! ├── database/abiding-word.db
//! ├── sources/    imported source files; teaching-images/ (kept generated images)
//! ├── indexes/    search indexes (later phase)
//! ├── cache/      disposable, can be deleted at any time
//! ├── sync/       sync state (later phase)
//! ├── backups/
//! │   ├── pre-migration/  automatic copies made before a schema upgrade
//! │   └── pre-restore/    copies made before a backup was restored
//! ├── exports/
//! └── logs/       diagnostic log files
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Folder name inside the operating system's per-user data directory.
pub const DATA_DIR_NAME: &str = "Abiding Word";

/// Environment variable that points the app at a different data directory.
/// Useful for development and testing, so real study data is never touched.
pub const DATA_DIR_ENV: &str = "ABIDING_WORD_DATA_DIR";

pub const DATABASE_FILE_NAME: &str = "abiding-word.db";

const SUBDIRECTORIES: [&str; 8] = [
    "database", "sources", "indexes", "cache", "sync", "backups", "exports", "logs",
];

#[derive(Debug, Clone)]
pub struct DataDirs {
    root: PathBuf,
}

impl DataDirs {
    /// Creates the root and all subdirectories if they are missing. Safe to
    /// call on every launch.
    pub fn ensure(root: impl Into<PathBuf>) -> AppResult<Self> {
        let dirs = Self { root: root.into() };
        for path in std::iter::once(dirs.root.clone())
            .chain(SUBDIRECTORIES.iter().map(|name| dirs.root.join(name)))
        {
            fs::create_dir_all(&path).map_err(|e| AppError::filesystem(&path, e))?;
        }
        Ok(dirs)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn database_file(&self) -> PathBuf {
        self.root.join("database").join(DATABASE_FILE_NAME)
    }

    /// Abiding Word's own copy of an imported Bible's source files.
    pub fn bible_sources(&self, translation_id: &str) -> PathBuf {
        self.root
            .join("sources")
            .join("bibles")
            .join(translation_id)
    }

    /// The library's managed files (`sources/`).
    pub fn sources(&self) -> PathBuf {
        self.root.join("sources")
    }

    pub fn pre_migration_backups(&self) -> PathBuf {
        self.root.join("backups").join("pre-migration")
    }

    /// Copies of the database made just before a backup was restored (v0.19).
    pub fn pre_restore_backups(&self) -> PathBuf {
        self.root.join("backups").join("pre-restore")
    }

    /// Disposable working space (unpacking a package, for one).
    pub fn cache(&self) -> PathBuf {
        self.root.join("cache")
    }

    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }

    /// Images the person generated with the assistant and chose to keep
    /// (v0.16), under names the app chose.
    pub fn teaching_images(&self) -> PathBuf {
        self.root.join("sources").join("teaching-images")
    }

    /// Copies of found images saved for presenting offline (v0.18), named
    /// by their address.
    pub fn presentation_images(&self) -> PathBuf {
        self.root.join("sources").join("presentation-images")
    }

    /// Church presentation templates' images (v0.18.1), named by their SHA-256.
    pub fn presentation_templates(&self) -> PathBuf {
        self.root.join("sources").join("presentation-templates")
    }
}

/// Copies files into `dir` (created if needed). Names that clash get a
/// numeric prefix. On failure the partial copy is removed.
pub fn copy_into(files: &[PathBuf], dir: &Path) -> AppResult<()> {
    let result = (|| {
        fs::create_dir_all(dir).map_err(|e| AppError::filesystem(dir, e))?;
        for (index, source) in files.iter().enumerate() {
            let name = source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("source-{index}"));
            let mut target = dir.join(&name);
            if target.exists() {
                target = dir.join(format!("{index}-{name}"));
            }
            fs::copy(source, &target).map_err(|e| AppError::filesystem(source, e))?;
        }
        Ok(())
    })();
    if result.is_err() {
        remove_managed(dir);
    }
    result
}

/// Deletes a folder Abiding Word created inside its own data directory.
/// Failures are logged, not raised: the database is already consistent.
pub fn remove_managed(dir: &Path) {
    if dir.exists() {
        if let Err(e) = fs::remove_dir_all(dir) {
            log::warn!("could not remove {}: {e}", dir.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_every_subdirectory_and_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join(DATA_DIR_NAME);

        let dirs = DataDirs::ensure(&root).unwrap();
        DataDirs::ensure(&root).unwrap();

        for name in SUBDIRECTORIES {
            assert!(root.join(name).is_dir(), "{name} missing");
        }
        assert_eq!(
            dirs.database_file(),
            root.join("database").join(DATABASE_FILE_NAME)
        );
    }

    #[test]
    fn copies_sources_without_touching_the_originals() {
        let temp = tempfile::tempdir().unwrap();
        let original = temp.path().join("john.usfm");
        fs::write(&original, b"\\id JHN").unwrap();
        let other = temp.path().join("other");
        fs::create_dir(&other).unwrap();
        let same_name = other.join("john.usfm");
        fs::write(&same_name, b"\\id 1JN").unwrap();
        let managed = temp.path().join("managed");

        copy_into(&[original.clone(), same_name], &managed).unwrap();
        assert_eq!(fs::read_dir(&managed).unwrap().count(), 2);

        remove_managed(&managed);
        assert!(!managed.exists());
        assert!(original.exists(), "the user's file must stay");
    }

    #[test]
    fn reports_a_filesystem_error_when_root_is_a_file() {
        let temp = tempfile::tempdir().unwrap();
        let blocker = temp.path().join("not-a-folder");
        fs::write(&blocker, b"x").unwrap();

        let error = DataDirs::ensure(&blocker).unwrap_err();
        assert!(matches!(error, AppError::Filesystem { .. }));
    }
}
