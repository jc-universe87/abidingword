//! The local data directory.
//!
//! Everything the user owns lives under one folder, so it can be found,
//! backed up and moved as a unit:
//!
//! ```text
//! Abiding Word/
//! ├── database/abiding-word.db
//! ├── sources/    imported source files (later phase)
//! ├── indexes/    search indexes (later phase)
//! ├── cache/      disposable, can be deleted at any time
//! ├── sync/       sync state (later phase)
//! ├── backups/
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

    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
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
    fn reports_a_filesystem_error_when_root_is_a_file() {
        let temp = tempfile::tempdir().unwrap();
        let blocker = temp.path().join("not-a-folder");
        fs::write(&blocker, b"x").unwrap();

        let error = DataDirs::ensure(&blocker).unwrap_err();
        assert!(matches!(error, AppError::Filesystem { .. }));
    }
}
