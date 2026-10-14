//! Upgrading a v0.9–v0.13 database (schema v5) to source annotations (v6):
//! backup first, nothing lost, Scripture annotations untouched, and the
//! never-used source-paragraph column of `annotations` carried over as notes.
//! The v5 database is written with plain SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{annotations, source_annotations, Database};
use abiding_word_lib::library::annotations::AnchorState;
use abiding_word_lib::scripture::reference::ScriptureRef;
use rusqlite::{Connection, OpenFlags};

const T: &str = "2026-10-01T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";
const SRC: &str = "00000000-0000-4000-8000-000000000601";

fn database_v5(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..5]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO sources (id, workspace_id, source_type, title, created_at, updated_at, passage_index_version)
             VALUES ('{SRC}', '{W}', 'book', 'Invented Book', '{T}', '{T}', 4);
         INSERT INTO source_files (id, source_id, relative_path, format, is_primary, extraction_status, created_at, updated_at)
             VALUES ('file-1', '{SRC}', 'books/x/book.md', 'markdown', 1, 'digital_text', '{T}', '{T}');
         INSERT INTO source_segments (id, source_id, source_file_id, position, content, section_path, locator, created_at, updated_at)
             VALUES ('seg-1', '{SRC}', 'file-1', 0, 'Abide in me.', 'Invented › Vine', 'Invented › Vine', '{T}', '{T}');
         INSERT INTO annotations (id, workspace_id, passage, start_key, end_key, kind, content, created_at, updated_at)
             VALUES ('ann-verse', '{W}', 'JHN.15.4', 43015004, 43015004, 'note', 'A Scripture note.', '{T}', '{T}');
         INSERT INTO annotations (id, workspace_id, source_segment_id, kind, content, created_at, updated_at)
             VALUES ('ann-segment', '{W}', 'seg-1', 'note', 'An old paragraph note.', '{T}', '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v5_database_is_backed_up_then_gains_source_annotations() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v5(&path);

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
        .starts_with("abiding-word-v5-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 5);

    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, 6);
        // Scripture annotations are as they were.
        let verse = annotations::list(conn, &ScriptureRef::from_canonical("JHN.15.4")?)?;
        assert_eq!(verse.len(), 1);
        assert_eq!(verse[0].content, "A Scripture note.");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM annotations", [], |r| r.get(0))?;
        assert_eq!(rows, 2, "no Scripture row removed or rewritten");

        // The old paragraph note is now a source note on that paragraph.
        let marks = source_annotations::list_for_source(conn, SRC)?;
        assert_eq!(marks.len(), 1);
        let note = &marks[0];
        assert_eq!(note.id, "ann-segment");
        assert_eq!(note.kind, "note");
        assert_eq!(note.content, "An old paragraph note.");
        assert_eq!(note.quote, None);
        assert_eq!(note.start.as_ref().unwrap().segment_id, "seg-1");
        assert_eq!(note.state, AnchorState::Exact);
        assert_eq!(note.locator.as_deref(), Some("Invented › Vine"));
        Ok(())
    })
    .unwrap();
    drop(db);

    // Opening again: no new backup, nothing duplicated.
    let again = Database::open(&path, &backups).unwrap();
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
    again
        .with_conn(|conn| {
            let rows: i64 =
                conn.query_row("SELECT COUNT(*) FROM source_annotations", [], |r| r.get(0))?;
            assert_eq!(rows, 1);
            Ok(())
        })
        .unwrap();
}
