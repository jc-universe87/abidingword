//! SQLite access.
//!
//! The frontend never sends SQL. Each table group has a small repository
//! module of plain functions that take a `&Connection`; commands call those
//! through [`Database::with_conn`].

pub mod annotations;
pub mod backup;
pub mod bibles;
pub mod blocks;
pub mod findings;
pub mod fts;
pub mod integrity;
pub mod library;
pub mod migrations;
pub mod presentation_templates;
pub mod presentations;
pub mod projects;
pub mod relations;
pub mod sections;
pub mod settings;
pub mod source_annotations;
pub mod studies;
pub mod study_passages;
pub mod study_search;
pub mod teaching;
pub mod teaching_templates;
pub mod templates;
pub mod text_refresh;
pub mod workspaces;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{AppError, AppResult, UserMessage};

pub struct Database {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
}

impl Database {
    /// Opens (creating if needed) the database file, checks its integrity,
    /// backs it up into `backup_dir` if migrations are pending, applies them
    /// and installs the default records. Safe on every launch.
    pub fn open(path: &Path, backup_dir: &Path) -> AppResult<Self> {
        let conn = Connection::open(path).map_err(integrity::from_sqlite)?;
        Self::initialise(conn, Some(path.to_path_buf()), Some(backup_dir))
    }

    /// A private in-memory database, fully migrated. Used by tests.
    pub fn open_in_memory() -> AppResult<Self> {
        Self::initialise(Connection::open_in_memory()?, None, None)
    }

    fn initialise(
        mut conn: Connection,
        path: Option<PathBuf>,
        backup_dir: Option<&Path>,
    ) -> AppResult<Self> {
        // Integrity first: even setting the journal mode writes to the file.
        integrity::check(&conn)?;
        configure(&conn)?;
        let report = migrations::upgrade(&mut conn, migrations::MIGRATIONS, backup_dir)?;
        log::info!(
            "database schema at version {} ({} migration(s) applied now)",
            report.migrations.to_version,
            report.migrations.applied.len()
        );
        workspaces::ensure_default(&conn)?;
        templates::ensure_builtin(&conn)?;
        // Derived passage links of sources imported before the current
        // derivation (a pure addition; the migration's backup already exists).
        // Derived data never stops the app from opening: a failure is logged and
        // the rebuild is tried again at the next start.
        if let Err(error) = library::ensure_passage_index(&conn) {
            log::warn!("passage links could not be brought up to date: {error}");
        }
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Runs `f` with exclusive access to the connection.
    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Unexpected("database connection lock poisoned".into()))?;
        f(&conn)
    }

    /// Runs `f` with exclusive, mutable access to the connection (restoring
    /// a backup into it, migrating it).
    pub fn with_conn_mut<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Unexpected("database connection lock poisoned".into()))?;
        f(&mut conn)
    }
}

/// After the whole database was replaced (a restored backup): the same
/// checks and steps as when the app starts.
pub(crate) fn reinitialise(conn: &mut Connection, backup_dir: Option<&Path>) -> AppResult<()> {
    integrity::check(conn)?;
    configure(conn)?;
    migrations::upgrade(conn, migrations::MIGRATIONS, backup_dir)?;
    workspaces::ensure_default(conn)?;
    templates::ensure_builtin(conn)?;
    if let Err(error) = library::ensure_passage_index(conn) {
        log::warn!("passage links could not be brought up to date: {error}");
    }
    Ok(())
}

fn configure(conn: &Connection) -> AppResult<()> {
    // WAL keeps the file consistent if the app or computer stops mid-write.
    // It returns a row, so it cannot go through execute_batch.
    let _mode: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
        .map_err(integrity::from_sqlite)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;",
    )?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}

/// Current UTC time as stored in every timestamp column.
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// For reorder requests: the new order must contain exactly the current
/// items, each once.
pub(crate) fn check_same_members(
    current: &[String],
    requested: &[String],
    what: &str,
) -> AppResult<()> {
    let mut a: Vec<&String> = current.iter().collect();
    let mut b: Vec<&String> = requested.iter().collect();
    a.sort();
    b.sort();
    if a != b {
        return Err(AppError::InvalidInput(UserMessage::new(
            "changedMeanwhile",
            format!("The {what} have changed since this page was shown. Please try again."),
        )));
    }
    Ok(())
}
