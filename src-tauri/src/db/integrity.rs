//! SQLite integrity checking.
//!
//! Runs before any migration touches the file. A damaged database is never
//! "repaired" automatically: the user's file is left exactly as it was and
//! the problem is reported.

use rusqlite::{Connection, ErrorCode};

use crate::error::{AppError, AppResult};

/// How many problem lines from SQLite are kept for the log.
const MAX_REPORTED_PROBLEMS: usize = 5;

/// `PRAGMA quick_check`: verifies page structure, indexes' basic shape and
/// constraints in time proportional to the file size. Passes silently.
pub fn check(conn: &Connection) -> AppResult<()> {
    let problems: Vec<String> = (|| {
        let mut stmt = conn.prepare("PRAGMA quick_check")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })()
    .map_err(from_sqlite)?;

    if problems.len() == 1 && problems[0] == "ok" {
        Ok(())
    } else {
        Err(AppError::Integrity(
            problems
                .into_iter()
                .take(MAX_REPORTED_PROBLEMS)
                .collect::<Vec<_>>()
                .join("; "),
        ))
    }
}

/// Classifies SQLite's own "this is not a usable database" errors as
/// integrity failures; everything else stays a database error.
pub fn from_sqlite(error: rusqlite::Error) -> AppError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => {
            AppError::Integrity(error.to_string())
        }
        _ => AppError::Database(error),
    }
}
