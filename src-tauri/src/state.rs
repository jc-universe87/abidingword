//! Startup and the state shared by all commands.
//!
//! Startup never panics. If the data folder or database cannot be prepared,
//! the failure is logged and kept here; the window still opens and the
//! frontend shows the user a clear message instead of a crash.

use std::path::PathBuf;

use rusqlite::Connection;

use crate::db::{migrations, Database};
use crate::error::{AppResult, ErrorPayload};
use crate::filesystem::DataDirs;

pub struct Core {
    pub dirs: DataDirs,
    pub db: Database,
}

pub struct AppState {
    startup: Result<Core, ErrorPayload>,
    log_dir: Option<PathBuf>,
}

impl AppState {
    /// Opens the database inside already-prepared data directories.
    pub fn start(dirs: AppResult<DataDirs>, log_dir: Option<PathBuf>) -> Self {
        let core = dirs.and_then(|dirs| {
            let path = dirs.database_file();
            log::info!("database file: {}", path.display());
            let db = Database::open(&path)?;
            Ok(Core { dirs, db })
        });
        match &core {
            Ok(_) => log::info!("startup complete"),
            Err(e) => log::error!("startup failed: {e}"),
        }
        Self {
            startup: core.map_err(ErrorPayload::from),
            log_dir,
        }
    }

    pub fn core(&self) -> Result<&Core, ErrorPayload> {
        self.startup.as_ref().map_err(Clone::clone)
    }

    pub fn startup_error(&self) -> Option<&ErrorPayload> {
        self.startup.as_ref().err()
    }

    pub fn log_dir(&self) -> Option<&PathBuf> {
        self.log_dir.as_ref()
    }

    /// Runs a database operation, converting (and logging) any error.
    pub fn db<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> Result<T, ErrorPayload> {
        Ok(self.core()?.db.with_conn(f)?)
    }

    pub fn schema_version(&self) -> Option<i64> {
        self.db(|conn| migrations::current_version(conn)).ok()
    }
}
