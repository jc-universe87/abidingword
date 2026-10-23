//! The Windows update and its rollback (v0.22.1), as the acceptance
//! checklist (docs/windows-acceptance-v0.22.md) asks the owner to do them,
//! on a real database file in WAL mode, as the app keeps it:
//!
//! - a schema-15 database (what 0.5.0-dev.41 writes) with sources, a Bible
//!   Study and its note, a citation, a Bible Teaching and a Bible text, and a
//!   last change still only in the WAL file (the app was not closed cleanly);
//! - the upgrade through 0016–0018: the pre-migration copy is complete
//!   (WAL included), passes an integrity check and is still schema 15; every
//!   row is kept;
//! - dev.41 refuses the upgraded database;
//! - rollback: the pre-migration copy restored with the WAL/SHM files of the
//!   newer database removed opens as schema 15 with the data as it was;
//! - a copy of the whole folder made with the app closed has no WAL file and
//!   restores as it was.
//!
//! All text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::Database;
use rusqlite::Connection;

const T: &str = "2026-01-01T00:00:00.000Z";

/// Every row the checklist asks the owner to compare after the update.
fn content(conn: &Connection) -> Vec<String> {
    let query = |sql: &str| -> Vec<String> {
        let mut stmt = conn.prepare(sql).unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    [
        "SELECT title FROM studies ORDER BY id",
        "SELECT content FROM study_blocks ORDER BY id",
        "SELECT content FROM findings ORDER BY id",
        "SELECT id || ':' || source_id || ':' || COALESCE(quote, '') FROM finding_sources ORDER BY id",
        "SELECT title FROM sources ORDER BY id",
        "SELECT title || ':' || introduction FROM teaching_preparations ORDER BY id",
        "SELECT title || ':' || explanation FROM teaching_points ORDER BY id",
        "SELECT text FROM bible_verse_texts ORDER BY id",
    ]
    .iter()
    .flat_map(|sql| query(sql))
    .collect()
}

fn version(conn: &Connection) -> i64 {
    migrations::current_version(conn).unwrap()
}

fn integrity(conn: &Connection) -> String {
    conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap()
}

/// A dev.41 database (schema 15), WAL mode, with the last change left in
/// the WAL file. Returns what it holds.
fn dev41_database(path: &Path) -> Vec<String> {
    let mut conn = Connection::open(path).unwrap();
    let mode: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    migrations::run_with(&mut conn, &MIGRATIONS[..15]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('w', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p', 'w', 'John', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s', 'p', 'Abiding in the Vine', 'passage', '{T}', '{T}');
         INSERT INTO study_sections (id, study_id, key, title, position, created_at, updated_at) VALUES ('sec', 's', NULL, 'Questions', 0, '{T}', '{T}');
         INSERT INTO study_blocks (id, section_id, block_type, position, content, created_at, updated_at) VALUES ('b', 'sec', 'paragraph', 0, 'Why a vine?', '{T}', '{T}');
         INSERT INTO findings (id, study_id, kind, content, created_at, updated_at) VALUES ('f', 's', 'quotation', 'Remain in me.', '{T}', '{T}');
         INSERT INTO sources (id, workspace_id, source_type, title, created_at, updated_at) VALUES ('lib', 'w', 'book', 'On the Vine', '{T}', '{T}');
         INSERT INTO finding_sources (id, finding_id, source_id, locator, cited_title, quote, created_at, updated_at) VALUES ('c', 'f', 'lib', 'p. 3', 'On the Vine', 'the vine', '{T}', '{T}');
         INSERT INTO teaching_preparations (id, study_id, title, kind, introduction, position, created_at, updated_at) VALUES ('tp', 's', 'Sunday', 'sermon', 'Hello', 0, '{T}', '{T}');
         INSERT INTO teaching_points (id, preparation_id, position, kind, title, explanation, created_at, updated_at) VALUES ('pt', 'tp', 0, 'point', 'Abide', 'Stay close.', '{T}', '{T}');
         INSERT INTO bible_translations (id, name, short_name, language, kind, source_type, source_origin, import_status, created_at, updated_at)
           VALUES ('t', 'Fixture', 'FIX', 'English', 'structured', 'usfm', 'managed_copy', 'ready', '{T}', '{T}');
         INSERT OR IGNORE INTO bible_verses (id, book_id, chapter, verse) VALUES (43015005, 43, 15, 5);
         INSERT INTO bible_verse_texts (translation_id, verse_id, text) VALUES ('t', 43015005, 'I am the vine.');"
    ))
    .unwrap();
    // The last change only in the WAL: the app stopped without a checkpoint.
    conn.execute_batch("PRAGMA wal_autocheckpoint = 0; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    conn.execute(
        "UPDATE study_blocks SET content = 'Why a vine? Written last.' WHERE id = 'b'",
        [],
    )
    .unwrap();
    let held = content(&conn);
    let wal = path.with_extension("db-wal");
    assert!(
        fs::metadata(&wal).unwrap().len() > 0,
        "the change is in the WAL"
    );
    // Leave the files as a stopped app leaves them: database + WAL, no checkpoint.
    let copy_dir = path.parent().unwrap().join("stopped");
    fs::create_dir_all(&copy_dir).unwrap();
    fs::copy(path, copy_dir.join("abiding-word.db")).unwrap();
    fs::copy(&wal, copy_dir.join("abiding-word.db-wal")).unwrap();
    drop(conn);
    fs::copy(copy_dir.join("abiding-word.db"), path).unwrap();
    fs::copy(copy_dir.join("abiding-word.db-wal"), &wal).unwrap();
    let _ = fs::remove_file(path.with_extension("db-shm"));
    held
}

#[test]
fn a_dev41_database_upgrades_with_a_complete_backup_and_rolls_back_cleanly() {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("Abiding Word");
    let database = data.join("database");
    let backups = data.join("backups").join("pre-migration");
    fs::create_dir_all(&database).unwrap();
    let path = database.join("abiding-word.db");
    let before = dev41_database(&path);
    assert!(before.contains(&"Why a vine? Written last.".to_string()));

    // B2: the whole folder copied with the app closed (here: a clean close of dev.41).
    {
        let conn = Connection::open(&path).unwrap();
        assert_eq!(content(&conn), before, "the WAL is read on open");
    }
    assert!(
        !path.with_extension("db-wal").exists(),
        "a clean close leaves no WAL file to copy"
    );
    let folder_copy = temp.path().join("folder-copy");
    copy_dir(&data, &folder_copy);

    // U1–U2: the update opens the database: backup first, then 0016–0018.
    let db = Database::open(&path, &backups).unwrap();
    let copies: Vec<_> = fs::read_dir(&backups)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(copies.len(), 1);
    let backup = copies[0].clone();
    assert!(backup
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("abiding-word-v15-"));
    {
        let copy = Connection::open(&backup).unwrap();
        assert_eq!(integrity(&copy), "ok");
        assert_eq!(version(&copy), 15);
        assert_eq!(
            content(&copy),
            before,
            "the backup holds everything, the last change included"
        );
    }
    db.with_conn(|conn| {
        assert_eq!(version(conn), 18);
        assert_eq!(integrity(conn), "ok");
        let broken: i64 =
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })?;
        assert_eq!(broken, 0);
        assert_eq!(content(conn), before, "every row kept");
        // Work done after the update: not in the backup.
        conn.execute(
            "UPDATE studies SET title = 'Changed after the update' WHERE id = 's'",
            [],
        )?;
        Ok(())
    })
    .unwrap();

    // dev.41 refuses a database written by the newer version.
    {
        let mut conn = Connection::open(&path).unwrap();
        assert!(migrations::upgrade(&mut conn, &MIGRATIONS[..15], None).is_err());
    }

    // R3: close the app, restore the pre-migration copy, remove the newer
    // database's WAL and SHM files, then open with dev.41.
    drop(db);
    for leftover in ["db-wal", "db-shm"] {
        let _ = fs::remove_file(path.with_extension(leftover));
    }
    fs::copy(&backup, &path).unwrap();
    {
        let mut conn = Connection::open(&path).unwrap();
        migrations::upgrade(&mut conn, &MIGRATIONS[..15], None).unwrap();
        assert_eq!(version(&conn), 15);
        assert_eq!(integrity(&conn), "ok");
        assert_eq!(content(&conn), before, "as it was before the update");
        assert!(
            !content(&conn).contains(&"Changed after the update".to_string()),
            "work done after the update is not in the backup"
        );
    }

    // Or: the whole folder copy from B2 put back.
    fs::remove_dir_all(&data).unwrap();
    copy_dir(&folder_copy, &data);
    {
        let mut conn = Connection::open(&path).unwrap();
        migrations::upgrade(&mut conn, &MIGRATIONS[..15], None).unwrap();
        assert_eq!(version(&conn), 15);
        assert_eq!(content(&conn), before);
    }
}

#[test]
fn a_newer_wal_file_left_beside_a_restored_copy_is_why_it_must_be_removed() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    let before = dev41_database(&path);
    let db = Database::open(&path, &backups).unwrap();
    let backup = fs::read_dir(&backups)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    // The newer app, stopped mid-way: a change only in its WAL file.
    db.with_conn(|conn| {
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
        conn.execute(
            "UPDATE studies SET title = 'Changed after the update' WHERE id = 's'",
            [],
        )?;
        Ok(())
    })
    .unwrap();
    let wal = path.with_extension("db-wal");
    let newer_wal = temp.path().join("newer.db-wal");
    fs::copy(&wal, &newer_wal).unwrap();
    drop(db);
    // Restoring only the database file, leaving the newer WAL beside it.
    fs::copy(&backup, &path).unwrap();
    fs::copy(&newer_wal, &wal).unwrap();
    let _ = fs::remove_file(path.with_extension("db-shm"));
    let outcome = Connection::open(&path).and_then(|conn| {
        let v = migrations::current_version(&conn).unwrap_or(-1);
        let ok: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap_or_else(|e| e.to_string());
        Ok((v, ok, content_or_error(&conn)))
    });
    // Whatever SQLite makes of it, it is not the database as it was before
    // the update: the checklist removes the WAL and SHM files first.
    let as_before = matches!(&outcome, Ok((15, ok, rows)) if ok == "ok" && *rows == before);
    eprintln!("restored copy with the newer WAL left beside it: {outcome:?}");
    assert!(!as_before);
}

fn content_or_error(conn: &Connection) -> Vec<String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| content(conn)))
        .unwrap_or_else(|_| vec!["(unreadable)".into()])
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}
