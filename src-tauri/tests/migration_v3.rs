//! Upgrading a Scripture v0.2 (schema v2) database to Studies v0.3 (v3).
//!
//! The v2 database is written with plain SQL against the v2 schema, as
//! Scripture v0.2 stored it.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{
    annotations, bibles, findings, projects, sections, settings, studies, study_passages,
    study_search, workspaces, Database,
};
use abiding_word_lib::domain::{PassageRole, StudyStatus, StudyType, Theme};
use abiding_word_lib::error::AppError;
use rusqlite::{Connection, OpenFlags};

const WORKSPACE: &str = "00000000-0000-4000-8000-00000000000a";
const PROJECT: &str = "00000000-0000-4000-8000-00000000000b";
const STUDY: &str = "00000000-0000-4000-8000-00000000000c";
const SECTION: &str = "00000000-0000-4000-8000-000000000100";
const BLOCK: &str = "00000000-0000-4000-8000-000000000200";
const BIBLE: &str = "00000000-0000-4000-8000-000000000300";

fn scripture_database(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..2]).unwrap();
    let t = "2026-09-29T10:00:00.000Z";
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{WORKSPACE}', 'My Workspace', 1, '{t}', '{t}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('{PROJECT}', '{WORKSPACE}', 'John Sermon Series', '{t}', '{t}');
         INSERT INTO studies (id, project_id, title, created_at, updated_at) VALUES ('{STUDY}', '{PROJECT}', 'The True Vine', '{t}', '{t}');
         INSERT INTO study_sections (id, study_id, key, title, position, created_at, updated_at) VALUES ('{SECTION}', '{STUDY}', 'text', 'Text', 0, '{t}', '{t}');
         INSERT INTO study_blocks (id, section_id, block_type, position, content, created_at, updated_at) VALUES ('{BLOCK}', '{SECTION}', 'paragraph', 0, 'Jesus speaks of remaining in him.', '{t}', '{t}');
         INSERT INTO passage_references (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, label, created_at, updated_at)
             VALUES ('p-older', '{STUDY}', 'JHN', 15, 1, 15, 11, 'John 15:1–11', '2026-09-29T10:00:00.000Z', '{t}');
         INSERT INTO passage_references (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, label, created_at, updated_at)
             VALUES ('p-newer', '{STUDY}', 'JHN', 14, 15, 14, 31, 'John 14:15–31', '2026-09-29T11:00:00.000Z', '{t}');
         INSERT INTO bible_translations (id, name, short_name, language, kind, source_type, source_origin, import_status, created_at, updated_at)
             VALUES ('{BIBLE}', 'Fixture', 'FX', 'English', 'structured', 'usfm', 'managed_copy', 'ready', '{t}', '{t}');
         INSERT INTO bible_verses (id, book_id, chapter, verse) VALUES (43015001, 43, 15, 1);
         INSERT INTO bible_verse_texts (translation_id, verse_id, text) VALUES ('{BIBLE}', 43015001, 'Fixture verse text.');
         INSERT INTO annotations (id, workspace_id, passage, start_key, end_key, kind, content, created_at, updated_at)
             VALUES ('note-1', '{WORKSPACE}', 'JHN.15.1', 43015001, 43015001, 'note', 'Remain.', '{t}', '{t}');
         INSERT INTO settings (key, value, created_at, updated_at) VALUES ('appearance.theme', '\"dark\"', '{t}', '{t}');
         INSERT INTO settings (key, value, created_at, updated_at) VALUES ('scripture.translation', '\"{BIBLE}\"', '{t}', '{t}');"
    ))
    .unwrap();
}

#[test]
fn a_scripture_database_upgrades_to_studies_with_a_backup() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    scripture_database(&path);

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
        .starts_with("abiding-word-v2-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 2);

    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, 3);
        assert_eq!(workspaces::get_default(conn)?.id, WORKSPACE);
        assert_eq!(projects::get(conn, PROJECT)?.title, "John Sermon Series");
        let study = studies::get(conn, STUDY)?;
        assert_eq!(
            (study.title.as_str(), study.study_type, study.status),
            ("The True Vine", StudyType::Passage, StudyStatus::Active)
        );
        assert_eq!(
            sections::get(conn, SECTION)?.blocks[0].content,
            "Jesus speaks of remaining in him."
        );

        // The earliest study passage became primary, the other related.
        let passages = study_passages::list(conn, STUDY)?;
        let roles: Vec<_> = passages.iter().map(|p| (p.id.as_str(), p.role)).collect();
        assert_eq!(
            roles,
            [
                ("p-older", PassageRole::Primary),
                ("p-newer", PassageRole::Related)
            ]
        );

        assert_eq!(bibles::get(conn, BIBLE)?.short_name, "FX");
        assert_eq!(
            bibles::chapter(conn, BIBLE, "JHN", 15)?.verses[0].text,
            "Fixture verse text."
        );
        assert_eq!(annotations::get(conn, "note-1")?.content, "Remain.");
        let s = settings::get(conn)?;
        assert_eq!(
            (s.theme, s.scripture_translation_id.as_deref()),
            (Theme::Dark, Some(BIBLE))
        );

        // Existing content is searchable straight away.
        let hits = study_search::search(conn, "remaining")?;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].study_id, STUDY);
        assert!(findings::list(conn, STUDY)?.is_empty());
        let (indexed, items): (i64, i64) = conn.query_row(
            "SELECT (SELECT COUNT(*) FROM study_search), (SELECT COUNT(*) FROM study_search_items)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        // One study title, one section title, one non-empty block.
        assert_eq!((indexed, items), (3, 3));
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_failed_backup_leaves_the_scripture_database_at_v2() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    scripture_database(&path);
    let blocked = temp.path().join("blocked");
    fs::write(&blocked, b"x").unwrap();

    assert!(matches!(
        Database::open(&path, &blocked).err().unwrap(),
        AppError::Backup { .. }
    ));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), 2);
    let columns: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('studies') WHERE name = 'study_type'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(columns, 0, "no part of 0003 applied");
}
