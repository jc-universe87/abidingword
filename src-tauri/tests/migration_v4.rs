//! Upgrading a Studies v0.3 (schema v3) database to Library v0.4 (v4).
//! The v3 database is written with plain SQL against the v3 schema.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{
    annotations, bibles, findings, library, projects, relations, sections, settings, studies,
    templates, workspaces, Database,
};
use abiding_word_lib::domain::{StudyType, Theme};
use abiding_word_lib::error::AppError;
use rusqlite::{Connection, OpenFlags};

const W: &str = "00000000-0000-4000-8000-00000000000a";
const P: &str = "00000000-0000-4000-8000-00000000000b";
const S1: &str = "00000000-0000-4000-8000-00000000000c";
const S2: &str = "00000000-0000-4000-8000-00000000000d";
const SEC: &str = "00000000-0000-4000-8000-000000000100";
const F: &str = "00000000-0000-4000-8000-000000000400";
const T: &str = "00000000-0000-4000-8000-000000000500";
const B: &str = "00000000-0000-4000-8000-000000000300";

fn studies_database(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..3]).unwrap();
    let t = "2026-09-30T10:00:00.000Z";
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{t}', '{t}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('{P}', '{W}', 'John Sermon Series', '{t}', '{t}');
         INSERT INTO studies (id, project_id, title, study_type, status, description, created_at, updated_at)
             VALUES ('{S1}', '{P}', 'John 15:1–11', 'passage', 'completed', 'Abiding', '{t}', '{t}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('{S2}', '{P}', 'Abiding in 1 John', 'topical', '{t}', '{t}');
         INSERT INTO study_sections (id, study_id, title, position, created_at, updated_at) VALUES ('{SEC}', '{S1}', 'Text', 0, '{t}', '{t}');
         INSERT INTO study_blocks (id, section_id, block_type, position, content, created_at, updated_at) VALUES ('blk', '{SEC}', 'question', 0, 'What is fruit?', '{t}', '{t}');
         INSERT INTO findings (id, study_id, kind, content, sort_order, created_at, updated_at) VALUES ('{F}', '{S1}', 'observation', 'Abide repeats.', 0, '{t}', '{t}');
         INSERT INTO passage_references (id, finding_id, book, start_chapter, start_verse, end_chapter, end_verse, label, created_at, updated_at)
             VALUES ('fp', '{F}', 'JHN', 15, 4, 15, 7, 'John 15:4–7', '{t}', '{t}');
         INSERT INTO finding_tags (finding_id, tag, created_at) VALUES ('{F}', 'sermon', '{t}');
         INSERT INTO study_relations (id, from_study_id, to_study_id, relation_type, created_at, updated_at) VALUES ('rel', '{S1}', '{S2}', 'continues', '{t}', '{t}');
         INSERT INTO study_templates (id, key, name, study_type, is_builtin, definition, created_at, updated_at)
             VALUES ('{T}', 'user-x', 'Short Passage Study', 'passage', 0, '{{\"sections\":[{{\"title\":\"Text\"}},{{\"title\":\"Prayer\"}}]}}', '{t}', '{t}');
         INSERT INTO bible_translations (id, name, short_name, language, kind, source_type, source_origin, import_status, created_at, updated_at)
             VALUES ('{B}', 'Fixture', 'FX', 'English', 'structured', 'usfm', 'managed_copy', 'ready', '{t}', '{t}');
         INSERT INTO bible_verses (id, book_id, chapter, verse) VALUES (43015001, 43, 15, 1);
         INSERT INTO bible_verse_texts (translation_id, verse_id, text) VALUES ('{B}', 43015001, 'Fixture verse.');
         INSERT INTO annotations (id, workspace_id, passage, start_key, end_key, kind, content, created_at, updated_at)
             VALUES ('note', '{W}', 'JHN.15.1', 43015001, 43015001, 'note', 'Remain.', '{t}', '{t}');
         INSERT INTO settings (key, value, created_at, updated_at) VALUES ('appearance.theme', '\"dark\"', '{t}', '{t}');"
    ))
    .unwrap();
}

#[test]
fn a_studies_database_upgrades_to_the_library_with_a_backup() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    studies_database(&path);

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
        .starts_with("abiding-word-v3-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 3);

    db.with_conn(|conn| {
        // Upgraded all the way to the current schema, not only to v4.
        assert_eq!(
            migrations::current_version(conn)?,
            MIGRATIONS.last().unwrap().version
        );
        assert_eq!(workspaces::get_default(conn)?.id, W);
        assert_eq!(projects::get(conn, P)?.study_count, 2);
        let s1 = studies::get(conn, S1)?;
        assert_eq!((s1.title.as_str(), s1.study_type, s1.description.as_deref()), ("John 15:1–11", StudyType::Passage, Some("Abiding")));
        assert_eq!(sections::get(conn, SEC)?.blocks[0].content, "What is fruit?");
        let f = findings::get(conn, F)?;
        assert_eq!((f.content.as_str(), f.passages[0].reference.canonical.as_str(), f.tags.clone()), ("Abide repeats.", "JHN.15.4-JHN.15.7", vec!["sermon".to_string()]));
        assert!(f.sources.is_empty());
        assert_eq!(relations::list(conn, S1)?[0].other.title, "Abiding in 1 John");
        assert_eq!(templates::get(conn, T)?.sections.len(), 2);
        assert_eq!(bibles::chapter(conn, B, "JHN", 15)?.verses[0].text, "Fixture verse.");
        assert_eq!(annotations::get(conn, "note")?.content, "Remain.");
        assert_eq!(settings::get(conn)?.theme, Theme::Dark);

        // The library is ready and empty; its index is consistent.
        assert!(library::list(conn, &Default::default())?.is_empty());
        let has_seq: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('source_segments') WHERE name = 'seq' AND pk = 1", [], |r| r.get(0))?;
        assert_eq!(has_seq, 1);
        conn.execute("INSERT INTO library_search (library_search, rank) VALUES ('integrity-check', 1)", [])?;
        assert_eq!(conn.query_row::<String, _, _>("PRAGMA foreign_key_check", [], |r| r.get(0)).ok(), None, "no dangling foreign keys");
        Ok(())
    })
    .unwrap();

    drop(db);
    Database::open(&path, &backups).unwrap();
    assert_eq!(
        fs::read_dir(&backups).unwrap().count(),
        1,
        "no second backup on a normal start"
    );
}

#[test]
fn a_failed_backup_leaves_the_studies_database_at_v3() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    studies_database(&path);
    let blocked = temp.path().join("blocked");
    fs::write(&blocked, b"x").unwrap();

    assert!(matches!(
        Database::open(&path, &blocked).err().unwrap(),
        AppError::Backup { .. }
    ));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), 3);
    let library_tables: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('library_search', 'source_passages')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(library_tables, 0, "no part of 0004 applied");
}
