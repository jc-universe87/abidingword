//! Startup and the state shared by all commands.
//!
//! Startup never panics. If the data folder or database cannot be prepared,
//! the failure is logged and kept here; the window still opens and the
//! frontend shows the user a clear message instead of a crash.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::db::{migrations, text_refresh, Database};
use crate::error::{AppError, AppResult, ErrorPayload};
use crate::filesystem::DataDirs;
use crate::library::import::StagedSource;
use crate::scripture::import::StagedImport;

pub struct Core {
    pub dirs: DataDirs,
    pub db: Database,
}

pub struct AppState {
    startup: Result<Core, ErrorPayload>,
    log_dir: Option<PathBuf>,
    /// Where bundled resources (e.g. included Bibles) are installed.
    resource_dir: Option<PathBuf>,
    /// The Bible import waiting on the verification screen, if any. Only
    /// one at a time; starting another replaces it.
    pending_import: Mutex<Option<StagedImport>>,
    /// The library import waiting on its preview screen, if any.
    pending_source: Mutex<Option<StagedSource>>,
}

impl AppState {
    /// Opens the database inside already-prepared data directories.
    pub fn start(
        dirs: AppResult<DataDirs>,
        log_dir: Option<PathBuf>,
        resource_dir: Option<PathBuf>,
    ) -> Self {
        let core = dirs.and_then(|dirs| {
            let path = dirs.database_file();
            log::info!("database file: {}", path.display());
            let db = Database::open(&path, &dirs.pre_migration_backups())?;
            // Imported EPUBs read again where extraction has improved (once per
            // improvement). Derived text never stops the app from opening.
            let sources = dirs.sources();
            if let Err(error) =
                db.with_conn(|conn| text_refresh::ensure_extracted_text(conn, &sources))
            {
                log::warn!("imported EPUB text could not be refreshed: {error}");
            }
            Ok(Core { dirs, db })
        });
        match &core {
            Ok(_) => log::info!("startup complete"),
            Err(e) => log::error!("startup failed: {e}"),
        }
        Self {
            startup: core.map_err(ErrorPayload::from),
            log_dir,
            resource_dir,
            pending_import: Mutex::new(None),
            pending_source: Mutex::new(None),
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

    pub fn resource_dir(&self) -> Option<&PathBuf> {
        self.resource_dir.as_ref()
    }

    pub fn pending_import(&self) -> Result<MutexGuard<'_, Option<StagedImport>>, ErrorPayload> {
        self.pending_import
            .lock()
            .map_err(|_| AppError::Unexpected("import staging lock poisoned".into()).into())
    }

    pub fn pending_source(&self) -> Result<MutexGuard<'_, Option<StagedSource>>, ErrorPayload> {
        self.pending_source
            .lock()
            .map_err(|_| AppError::Unexpected("library staging lock poisoned".into()).into())
    }

    pub fn schema_version(&self) -> Option<i64> {
        self.db(migrations::current_version).ok()
    }
}
