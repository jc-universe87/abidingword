//! Versioned schema migrations.
//!
//! * Each migration is a SQL file in `src-tauri/migrations/`, compiled into
//!   the app and listed in [`MIGRATIONS`] with a strictly increasing version.
//! * On startup every migration newer than the recorded version runs, each in
//!   its own transaction together with its `schema_versions` row. A failure
//!   rolls that migration back completely and stops startup.
//! * A database written by a newer version of the app is refused rather than
//!   risked.
//! * Released migrations are never edited; changes always go in a new file.

use rusqlite::{params, Connection};

use crate::db::now;
use crate::error::{AppError, AppResult};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "initial_schema",
    sql: include_str!("../../migrations/0001_initial_schema.sql"),
}];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    pub from_version: i64,
    pub to_version: i64,
    pub applied: Vec<i64>,
}

pub fn run(conn: &mut Connection) -> AppResult<MigrationReport> {
    run_with(conn, MIGRATIONS)
}

/// Runs a given migration list. Separate from [`run`] so tests can supply
/// their own migrations.
pub fn run_with(conn: &mut Connection, migrations: &[Migration]) -> AppResult<MigrationReport> {
    check_order(migrations)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
             version     INTEGER PRIMARY KEY NOT NULL,
             name        TEXT NOT NULL,
             applied_at  TEXT NOT NULL
         );",
    )?;

    let from_version = current_version(conn)?;
    let latest_known = migrations.last().map_or(0, |m| m.version);
    if from_version > latest_known {
        return Err(AppError::Migration {
            version: from_version,
            name: "unknown".into(),
            message: format!(
                "database schema version {from_version} is newer than this app supports \
                 ({latest_known}); refusing to open it"
            ),
        });
    }

    let mut applied = Vec::new();
    for migration in migrations.iter().filter(|m| m.version > from_version) {
        apply(conn, migration).map_err(|e| AppError::Migration {
            version: migration.version,
            name: migration.name.into(),
            message: e.to_string(),
        })?;
        log::info!(
            "applied migration {} ({})",
            migration.version,
            migration.name
        );
        applied.push(migration.version);
    }

    Ok(MigrationReport {
        from_version,
        to_version: current_version(conn)?,
        applied,
    })
}

pub fn current_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_versions",
        [],
        |row| row.get(0),
    )?)
}

fn apply(conn: &mut Connection, migration: &Migration) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(migration.sql)?;
    tx.execute(
        "INSERT INTO schema_versions (version, name, applied_at) VALUES (?1, ?2, ?3)",
        params![migration.version, migration.name, now()],
    )?;
    tx.commit()
}

fn check_order(migrations: &[Migration]) -> AppResult<()> {
    let ordered = migrations
        .windows(2)
        .all(|pair| pair[0].version < pair[1].version);
    if ordered && migrations.first().is_none_or(|m| m.version >= 1) {
        Ok(())
    } else {
        Err(AppError::Unexpected(
            "migration list is not in strictly increasing version order".into(),
        ))
    }
}
