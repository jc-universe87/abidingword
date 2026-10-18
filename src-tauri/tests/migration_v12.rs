//! Upgrading a v0.18 database (schema v11) to v12 (church presentation
//! templates): backup first; presentations with their order, background,
//! notes, links to the teaching and target time exactly as before; no
//! template chosen by itself; a second start changes nothing. The v11
//! database is written with plain SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{presentation_templates, presentations, Database};
use rusqlite::Connection;

const T: &str = "2026-10-18T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";

fn database_v11(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..11]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s-1', 'p-1', 'John 15', 'passage', '{T}', '{T}');
         INSERT INTO teaching_preparations (id, study_id, title, kind, introduction, central_message, position, created_at, updated_at) VALUES
           ('tp-1', 's-1', 'Sunday', 'sermon', 'Hello!', 'Jesus is the vine.', 0, '{T}', '{T}');
         INSERT INTO teaching_points (id, preparation_id, position, kind, title, explanation, created_at, updated_at) VALUES
           ('pt-1', 'tp-1', 0, NULL, 'Stay connected', 'Branches live from the vine.', '{T}', '{T}');
         INSERT INTO presentations (id, preparation_id, title, theme, position, created_at, updated_at, target_minutes) VALUES
           ('pr-1', 'tp-1', 'Sunday slides', 'dark', 0, '{T}', '{T}', 30);
         INSERT INTO presentation_items (id, presentation_id, position, kind, source_kind, source_id, heading, notes, skipped, created_at, updated_at) VALUES
           ('it-1', 'pr-1', 0, 'title', 'preparation', 'tp-1', NULL, 'Smile.', 0, '{T}', '{T}'),
           ('it-2', 'pr-1', 1, 'heading', 'point', 'pt-1', 'Joined to him', '', 1, '{T}', '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v11_database_is_backed_up_and_its_presentations_keep_everything() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v11(&path);

    let db = Database::open(&path, &backups).unwrap();
    let files: Vec<_> = fs::read_dir(&backups)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    assert!(files[0]
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("abiding-word-v11-"));
    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, 12);
        let p = presentations::get(conn, "pr-1")?;
        assert_eq!(
            (p.title.as_str(), p.theme.as_str()),
            ("Sunday slides", "dark")
        );
        assert_eq!(p.target_minutes, Some(30));
        assert_eq!(p.template_id, None);
        let ids: Vec<&str> = p.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["it-1", "it-2"]);
        assert_eq!(p.items[0].notes, "Smile.");
        assert_eq!(p.items[1].heading.as_deref(), Some("Joined to him"));
        assert!(p.items[1].skipped);
        assert_eq!(p.items[1].source.as_ref().unwrap().id, "pt-1");
        assert!(presentation_templates::list(conn)?.is_empty());
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
