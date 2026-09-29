//! Safety copies of the database.
//!
//! Uses SQLite's `VACUUM INTO`, which writes a complete, consistent copy of
//! the live database (including anything still in the WAL file) as a new
//! file. Plain file copying could capture a half-written state.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::db::{integrity, migrations};
use crate::error::{AppError, AppResult};

/// Writes `abiding-word-v<version>-<UTC timestamp>.db` into `dir` and checks
/// that the copy opens, passes an integrity check and has the same schema
/// version. Returns the path of the verified backup.
pub fn pre_migration(conn: &Connection, dir: &Path, version: i64) -> AppResult<PathBuf> {
    fs::create_dir_all(dir).map_err(|e| backup_error(dir, e.to_string()))?;

    // Colons are not allowed in Windows file names.
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ");
    let path = dir.join(format!("abiding-word-v{version}-{stamp}.db"));
    if path.exists() {
        return Err(backup_error(
            &path,
            "a backup with this name already exists".into(),
        ));
    }
    let target = path
        .to_str()
        .ok_or_else(|| backup_error(&path, "path is not valid UTF-8".into()))?;

    conn.execute("VACUUM INTO ?1", [target])
        .map_err(|e| backup_error(&path, e.to_string()))?;

    verify(&path, version).map_err(|e| backup_error(&path, format!("verification failed: {e}")))?;
    Ok(path)
}

fn verify(path: &Path, expected_version: i64) -> AppResult<()> {
    let copy = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    integrity::check(&copy)?;
    let version = migrations::current_version(&copy)?;
    if version != expected_version {
        return Err(AppError::Unexpected(format!(
            "backup has schema version {version}, expected {expected_version}"
        )));
    }
    Ok(())
}

fn backup_error(path: &Path, message: String) -> AppError {
    AppError::Backup {
        path: path.to_path_buf(),
        message,
    }
}
