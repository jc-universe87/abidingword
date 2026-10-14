//! Upgrading a v0.14 database (schema v6) to v0.15 (v7, quotes and places on
//! finding citations): backup first, every existing citation reads exactly as
//! before, with the new columns empty. The v6 database is written with plain
//! SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::findings;
use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::Database;
use rusqlite::{Connection, OpenFlags};

const T: &str = "2026-10-14T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";
const SRC: &str = "00000000-0000-4000-8000-000000000701";
const GONE: &str = "00000000-0000-4000-8000-000000000702";

fn database_v6(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..6]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, created_at, updated_at) VALUES ('s-1', 'p-1', 'Abiding', '{T}', '{T}');
         INSERT INTO findings (id, study_id, kind, content, created_at, updated_at) VALUES ('f-1', 's-1', 'quotation', 'Abide in me.', '{T}', '{T}');
         INSERT INTO sources (id, workspace_id, source_type, title, author, created_at, updated_at, passage_index_version)
             VALUES ('{SRC}', '{W}', 'book', 'Invented Book', 'A. Writer', '{T}', '{T}', 4);
         INSERT INTO sources (id, workspace_id, source_type, title, created_at, updated_at, deleted_at, passage_index_version)
             VALUES ('{GONE}', '{W}', 'book', 'Removed Book', '{T}', '{T}', '{T}', 4);
         INSERT INTO source_files (id, source_id, relative_path, format, is_primary, extraction_status, created_at, updated_at)
             VALUES ('file-1', '{SRC}', 'books/x/book.md', 'markdown', 1, 'digital_text', '{T}', '{T}');
         INSERT INTO source_segments (id, source_id, source_file_id, position, content, section_path, locator, created_at, updated_at)
             VALUES ('seg-1', '{SRC}', 'file-1', 0, 'Abide in me.', 'Invented › Vine', 'Invented › Vine', '{T}', '{T}');
         INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator, cited_title, cited_author, created_at, updated_at)
             VALUES ('c-1', 'f-1', '{SRC}', 'seg-1', 'Invented › Vine', 'Invented Book', 'A. Writer', '{T}', '{T}');
         INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator, cited_title, cited_author, created_at, updated_at)
             VALUES ('c-2', 'f-1', '{GONE}', NULL, 'p. 4', 'Removed Book', NULL, '{T}', '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v6_database_is_backed_up_and_its_citations_read_as_before() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v6(&path);

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
        .starts_with("abiding-word-v6-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 6);

    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, 7);
        let finding = findings::get(conn, "f-1")?;
        assert_eq!(finding.content, "Abide in me.");
        assert_eq!(finding.sources.len(), 2);
        let (live, gone) = (&finding.sources[0], &finding.sources[1]);
        assert_eq!(live.title, "Invented Book");
        assert_eq!(live.author.as_deref(), Some("A. Writer"));
        assert_eq!(live.locator.as_deref(), Some("Invented › Vine"));
        assert_eq!(live.segment_id.as_deref(), Some("seg-1"));
        assert!(!live.removed);
        assert_eq!(
            (&live.quote, &live.section, &live.annotation_id),
            (&None, &None, &None)
        );
        assert!(gone.removed);
        assert_eq!(gone.title, "Removed Book");
        // An old citation opens at its paragraph, as before.
        let place = findings::locate_source(conn, "c-1")?.unwrap();
        assert_eq!(place.segment_id.as_deref(), Some("seg-1"));
        assert!(place.words.is_none());
        assert_eq!(findings::locate_source(conn, "c-2")?, None);
        Ok(())
    })
    .unwrap();
    drop(db);

    // Opening again: no new backup, nothing changed.
    let again = Database::open(&path, &backups).unwrap();
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
    again
        .with_conn(|conn| {
            let rows: i64 =
                conn.query_row("SELECT COUNT(*) FROM finding_sources", [], |r| r.get(0))?;
            assert_eq!(rows, 2);
            Ok(())
        })
        .unwrap();
}
