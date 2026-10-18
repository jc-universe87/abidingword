//! Upgrading a v0.18 database (schema v10) to v11 (a presentation's target
//! time): backup first, presentations and their slides exactly as before,
//! no target time set by itself, a second start changes nothing. The v10
//! database is written with plain SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{presentations, Database};
use rusqlite::Connection;

const T: &str = "2026-10-18T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";

fn database_v10(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..10]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s-1', 'p-1', 'John 15', 'passage', '{T}', '{T}');
         INSERT INTO teaching_preparations (id, study_id, title, kind, introduction, central_message, position, created_at, updated_at) VALUES
           ('tp-1', 's-1', 'Sunday', 'sermon', 'Hello!', 'Jesus is the vine.', 0, '{T}', '{T}');
         INSERT INTO presentations (id, preparation_id, title, theme, position, created_at, updated_at) VALUES
           ('pr-1', 'tp-1', 'Sunday slides', 'warm', 0, '{T}', '{T}');
         INSERT INTO presentation_items (id, presentation_id, position, kind, heading, notes, created_at, updated_at) VALUES
           ('it-1', 'pr-1', 0, 'title', 'Remain in me', 'Smile.', '{T}', '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v10_database_is_backed_up_and_its_presentations_gain_an_empty_target_time() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v10(&path);

    let db = Database::open(&path, &backups).unwrap();
    let files: Vec<_> = fs::read_dir(&backups).unwrap().collect();
    assert_eq!(files.len(), 1);
    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, MIGRATIONS.len() as i64);
        let p = presentations::get(conn, "pr-1")?;
        assert_eq!(p.title, "Sunday slides");
        assert_eq!(p.theme, "warm");
        assert_eq!(p.target_minutes, None);
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].notes, "Smile.");
        Ok(())
    })
    .unwrap();
    drop(db);
    Database::open(&path, &backups).unwrap();
    assert_eq!(
        fs::read_dir(&backups).unwrap().count(),
        1,
        "no second backup"
    );
}
