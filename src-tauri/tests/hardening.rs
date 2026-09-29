//! Foundation hardening: integrity check and pre-migration backup.

use std::fs;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::migrations::{self, Migration, MIGRATIONS};
use abiding_word_lib::db::{projects, workspaces, Database};
use abiding_word_lib::domain::CreateProject;
use abiding_word_lib::error::AppError;
use rusqlite::{Connection, OpenFlags};

/// Migration 1 as released, plus a harmless test-only migration 2 standing
/// in for "a future schema change".
fn with_test_upgrade() -> Vec<Migration> {
    vec![
        Migration {
            version: MIGRATIONS[0].version,
            name: MIGRATIONS[0].name,
            sql: MIGRATIONS[0].sql,
        },
        Migration {
            version: 2,
            name: "test_upgrade",
            sql: "CREATE TABLE test_upgrade_marker (id INTEGER);",
        },
    ]
}

/// A database at schema version 1 containing one project.
fn version_one_database(path: &Path) -> String {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..1]).unwrap();
    workspaces::ensure_default(&conn).unwrap();
    let workspace = workspaces::get_default(&conn).unwrap();
    projects::create(
        &conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: "Romans Sermon Series".into(),
            description: None,
        },
    )
    .unwrap()
    .id
}

fn files_in(dir: &Path) -> Vec<PathBuf> {
    match fs::read_dir(dir) {
        Ok(entries) => entries.map(|e| e.unwrap().path()).collect(),
        Err(_) => Vec::new(),
    }
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

#[test]
fn a_new_database_and_a_current_database_get_no_backup() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");

    Database::open(&path, &backups).unwrap();
    drop(Database::open(&path, &backups).unwrap());

    assert!(files_in(&backups).is_empty(), "unexpected backup");
}

#[test]
fn pending_migrations_on_an_existing_database_create_a_readable_backup_first() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let project_id = version_one_database(&path);

    let mut conn = Connection::open(&path).unwrap();
    let report = migrations::upgrade(&mut conn, &with_test_upgrade(), Some(&backups)).unwrap();

    assert_eq!(report.migrations.applied, vec![2]);
    let backup = report.backup.expect("backup should have been made");
    assert_eq!(files_in(&backups), vec![backup.clone()]);
    let name = backup.file_name().unwrap().to_str().unwrap();
    assert!(
        name.starts_with("abiding-word-v1-") && name.ends_with(".db"),
        "{name}"
    );
    assert!(
        !name.contains(':'),
        "file name must be valid on Windows: {name}"
    );

    // The backup is a valid database holding the pre-migration state.
    let copy = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 1);
    assert!(!table_exists(&copy, "test_upgrade_marker"));
    assert_eq!(
        projects::get(&copy, &project_id).unwrap().title,
        "Romans Sermon Series"
    );

    // The live database moved on.
    assert_eq!(migrations::current_version(&conn).unwrap(), 2);
}

#[test]
fn a_failed_backup_blocks_the_migration() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    version_one_database(&path);
    // A file where the backup folder should be makes the backup impossible.
    let blocked = temp.path().join("backups");
    fs::write(&blocked, b"not a folder").unwrap();

    let mut conn = Connection::open(&path).unwrap();
    let error = migrations::upgrade(&mut conn, &with_test_upgrade(), Some(&blocked)).unwrap_err();

    assert!(matches!(error, AppError::Backup { .. }), "{error:?}");
    assert_eq!(migrations::current_version(&conn).unwrap(), 1);
    assert!(!table_exists(&conn, "test_upgrade_marker"));
}

#[test]
fn a_file_that_is_not_a_database_is_refused_and_left_untouched() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let garbage: Vec<u8> = (0..16_384u32).map(|i| (i * 31 % 251) as u8).collect();
    fs::write(&path, &garbage).unwrap();

    let error = Database::open(&path, &temp.path().join("backups"))
        .err()
        .unwrap();

    assert!(matches!(error, AppError::Integrity(_)), "{error:?}");
    assert_eq!(
        fs::read(&path).unwrap(),
        garbage,
        "damaged file was modified"
    );
}

#[test]
fn a_damaged_database_blocks_migration() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    version_one_database(&path);
    // Rewrite to a single rollback-journal file, then damage a b-tree page
    // after the header page.
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA journal_mode = DELETE; VACUUM;")
            .unwrap();
    }
    let mut bytes = fs::read(&path).unwrap();
    let page_size = u16::from_be_bytes([bytes[16], bytes[17]]) as usize;
    assert!(bytes.len() >= page_size * 4, "database too small to damage");
    for byte in &mut bytes[page_size * 2..page_size * 2 + 64] {
        *byte = 0xFF;
    }
    fs::write(&path, &bytes).unwrap();
    let backups = temp.path().join("backups");

    let mut conn = Connection::open(&path).unwrap();
    let error = migrations::upgrade(&mut conn, &with_test_upgrade(), Some(&backups)).unwrap_err();

    assert!(matches!(error, AppError::Integrity(_)), "{error:?}");
    assert!(files_in(&backups).is_empty(), "no backup of a damaged file");
    drop(conn);
    assert_eq!(fs::read(&path).unwrap(), bytes, "damaged file was modified");
}

#[test]
fn the_user_message_for_damage_is_plain() {
    let payload = abiding_word_lib::error::ErrorPayload::from(AppError::Integrity(
        "*** in database main *** Page 3: btreeInitPage() returns error code 11".into(),
    ));
    assert!(!payload.message.contains("btree"));
    assert!(payload.message.contains("has not been modified"));
}

#[test]
fn a_problem_reported_by_quick_check_blocks_migration() {
    // Damage SQLite does not trip over while reading, but quick_check
    // reports: a row that breaks a CHECK constraint.
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    version_one_database(&path);
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA ignore_check_constraints = ON;
             UPDATE workspaces SET is_default = 7;
             PRAGMA ignore_check_constraints = OFF;",
        )
        .unwrap();
    }
    let backups = temp.path().join("backups");

    let mut conn = Connection::open(&path).unwrap();
    let error = migrations::upgrade(&mut conn, &with_test_upgrade(), Some(&backups)).unwrap_err();

    match error {
        AppError::Integrity(detail) => assert!(detail.contains("CHECK"), "{detail}"),
        other => panic!("expected an integrity error, got {other:?}"),
    }
    assert!(files_in(&backups).is_empty());
    assert_eq!(migrations::current_version(&conn).unwrap(), 1);
}
