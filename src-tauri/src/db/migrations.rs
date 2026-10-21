//! Versioned schema migrations.
//!
//! * Each migration is a SQL file in `src-tauri/migrations/`, compiled into
//!   the app and listed in [`MIGRATIONS`] with a strictly increasing version.
//! * On startup every migration newer than the recorded version runs, each in
//!   its own transaction together with its `schema_versions` row. A failure
//!   rolls that migration back completely and stops startup.
//! * A database written by a newer version of the app is refused rather than
//!   risked.
//! * [`upgrade`] is the startup entry point: it checks integrity first and,
//!   when an existing database has pending migrations, makes a verified
//!   backup before changing anything.
//! * Released migrations are never edited; changes always go in a new file.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::db::{backup, integrity, now};
use crate::error::{AppError, AppResult};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_schema",
        sql: include_str!("../../migrations/0001_initial_schema.sql"),
    },
    Migration {
        version: 2,
        name: "scripture",
        sql: include_str!("../../migrations/0002_scripture.sql"),
    },
    Migration {
        version: 3,
        name: "studies",
        sql: include_str!("../../migrations/0003_studies.sql"),
    },
    Migration {
        version: 4,
        name: "library",
        sql: include_str!("../../migrations/0004_library.sql"),
    },
    Migration {
        version: 5,
        name: "passage_sections",
        sql: include_str!("../../migrations/0005_passage_sections.sql"),
    },
    Migration {
        version: 6,
        name: "source_annotations",
        sql: include_str!("../../migrations/0006_source_annotations.sql"),
    },
    Migration {
        version: 7,
        name: "finding_source_quotes",
        sql: include_str!("../../migrations/0007_finding_source_quotes.sql"),
    },
    Migration {
        version: 8,
        name: "teaching_preparations",
        sql: include_str!("../../migrations/0008_teaching_preparations.sql"),
    },
    Migration {
        version: 9,
        name: "teaching_step_kinds",
        sql: include_str!("../../migrations/0009_teaching_step_kinds.sql"),
    },
    Migration {
        version: 10,
        name: "presentations",
        sql: include_str!("../../migrations/0010_presentations.sql"),
    },
    Migration {
        version: 11,
        name: "presentation_target",
        sql: include_str!("../../migrations/0011_presentation_target.sql"),
    },
    Migration {
        version: 12,
        name: "presentation_templates",
        sql: include_str!("../../migrations/0012_presentation_templates.sql"),
    },
    Migration {
        version: 13,
        name: "study_phases",
        sql: include_str!("../../migrations/0013_study_phases.sql"),
    },
    Migration {
        version: 14,
        name: "teaching_templates",
        sql: include_str!("../../migrations/0014_teaching_templates.sql"),
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    pub from_version: i64,
    pub to_version: i64,
    pub applied: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeReport {
    pub migrations: MigrationReport,
    /// Set when a pre-migration backup was made.
    pub backup: Option<std::path::PathBuf>,
}

/// Brings a database up to date safely:
///
/// 1. integrity check — a damaged file is never migrated;
/// 2. if migrations are pending on a database that already has a schema,
///    a verified backup into `backup_dir` — no backup, no migration;
/// 3. the migrations themselves.
///
/// A new, empty database has nothing to lose, so it gets no backup; nor does
/// a database that is already current.
pub fn upgrade(
    conn: &mut Connection,
    migrations: &[Migration],
    backup_dir: Option<&Path>,
) -> AppResult<UpgradeReport> {
    integrity::check(conn)?;
    ensure_versions_table(conn)?;
    let from_version = current_version(conn)?;
    let pending = migrations
        .iter()
        .filter(|m| m.version > from_version)
        .count();

    let backup = match backup_dir {
        Some(dir) if pending > 0 && from_version > 0 => {
            let path = backup::pre_migration(conn, dir, from_version)?;
            log::info!("pre-migration backup written: {}", path.display());
            Some(path)
        }
        _ => None,
    };

    Ok(UpgradeReport {
        migrations: run_with(conn, migrations)?,
        backup,
    })
}

fn ensure_versions_table(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
             version     INTEGER PRIMARY KEY NOT NULL,
             name        TEXT NOT NULL,
             applied_at  TEXT NOT NULL
         );",
    )?;
    Ok(())
}

pub fn run(conn: &mut Connection) -> AppResult<MigrationReport> {
    run_with(conn, MIGRATIONS)
}

/// Runs a given migration list. Separate from [`run`] so tests can supply
/// their own migrations.
pub fn run_with(conn: &mut Connection, migrations: &[Migration]) -> AppResult<MigrationReport> {
    check_order(migrations)?;
    ensure_versions_table(conn)?;

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
