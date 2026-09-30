//! Upgrading a Foundation (schema v1) database to the current schema,
//! through the Scripture (v2) and Studies (v3) migrations.
//!
//! The v1 database is written with plain SQL against the v1 schema, exactly
//! as Foundation v0.1 stored it; today's repository code expects today's
//! schema and must not be used to fake an old database.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{
    annotations, projects, sections, studies, study_passages, workspaces, Database,
};
use abiding_word_lib::domain::{PassageRole, StudyStatus, StudyType};
use abiding_word_lib::error::AppError;
use abiding_word_lib::scripture::reference::ScriptureRef;
use rusqlite::{Connection, OpenFlags};

const WORKSPACE: &str = "00000000-0000-4000-8000-00000000000a";
const PROJECT: &str = "00000000-0000-4000-8000-00000000000b";
const STUDY: &str = "00000000-0000-4000-8000-00000000000c";
const RENAMED_SECTION: &str = "00000000-0000-4000-8000-000000000102";

/// A database exactly as Foundation v0.1 left it: a project, a passage study
/// with nine sections (one renamed, one with text), a study passage and an
/// old-style annotation.
fn foundation_database(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..1]).unwrap();
    let t = "2026-09-01T10:00:00.000Z";
    let mut sql = format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{WORKSPACE}', 'My Workspace', 1, '{t}', '{t}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('{PROJECT}', '{WORKSPACE}', 'Romans Sermon Series', '{t}', '{t}');
         INSERT INTO studies (id, project_id, title, created_at, updated_at) VALUES ('{STUDY}', '{PROJECT}', 'Romans 8:1–17', '{t}', '{t}');"
    );
    let titles = [
        "Text",
        "Context",
        "What I notice",
        "Structure",
        "Exegesis",
        "Theology",
        "Application",
        "Audience",
        "Teaching",
    ];
    for (i, title) in titles.iter().enumerate() {
        let section = format!("00000000-0000-4000-8000-0000000001{i:02}");
        let block = format!("00000000-0000-4000-8000-0000000002{i:02}");
        let content = if i == 1 {
            "Paul has just finished Romans 7."
        } else {
            ""
        };
        sql.push_str(&format!(
            "INSERT INTO study_sections (id, study_id, title, position, created_at, updated_at) VALUES ('{section}', '{STUDY}', '{title}', {i}, '{t}', '{t}');
             INSERT INTO study_blocks (id, section_id, block_type, position, content, created_at, updated_at) VALUES ('{block}', '{section}', 'paragraph', 0, '{content}', '{t}', '{t}');"
        ));
    }
    sql.push_str(&format!(
        "INSERT INTO passage_references (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, label, created_at, updated_at)
         VALUES ('p1', '{STUDY}', 'ROM', 8, 1, 8, 17, 'Romans 8:1–17', '{t}', '{t}');
         INSERT INTO annotations (id, workspace_id, passage_reference_id, kind, content, created_at, updated_at)
         VALUES ('a1', '{WORKSPACE}', 'p1', 'note', 'Old note', '{t}', '{t}');"
    ));
    conn.execute_batch(&sql).unwrap();
}

#[test]
fn a_foundation_database_upgrades_with_a_backup_and_keeps_its_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("backups").join("pre-migration");
    foundation_database(&path);

    let db = Database::open(&path, &backups).unwrap();

    // Backup first, holding the v1 state.
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
        .starts_with("abiding-word-v1-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 1);

    db.with_conn(|conn| {
        assert_eq!(
            migrations::current_version(conn)?,
            MIGRATIONS.last().unwrap().version
        );
        assert_eq!(workspaces::get_default(conn)?.id, WORKSPACE);
        assert_eq!(projects::get(conn, PROJECT)?.study_count, 1);
        let study = studies::get(conn, STUDY)?;
        assert_eq!(study.title, "Romans 8:1–17");
        assert_eq!(
            (study.study_type, study.status),
            (StudyType::Passage, StudyStatus::Active)
        );
        assert_eq!(sections::get(conn, RENAMED_SECTION)?.title, "What I notice");
        let all = sections::list(conn, STUDY)?;
        assert_eq!(all.len(), 9);
        assert_eq!(all[1].blocks[0].content, "Paul has just finished Romans 7.");
        let books: i64 = conn.query_row("SELECT COUNT(*) FROM bible_books", [], |r| r.get(0))?;
        assert_eq!(books, 66);

        // The study passage became primary; the old annotation was carried over.
        let passages = study_passages::list(conn, STUDY)?;
        assert_eq!(passages.len(), 1);
        assert_eq!(passages[0].role, PassageRole::Primary);
        let note = annotations::get(conn, "a1")?;
        assert_eq!(note.reference.canonical, "ROM.8.1-ROM.8.17");
        assert_eq!(note.content, "Old note");
        let found = annotations::list(conn, &ScriptureRef::from_canonical("ROM.8.10").unwrap())?;
        assert_eq!(found.len(), 1);
        Ok(())
    })
    .unwrap();

    // Opening again is a normal start: no further backup.
    drop(db);
    Database::open(&path, &backups).unwrap();
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
}

#[test]
fn if_the_backup_cannot_be_made_the_foundation_database_is_left_at_v1() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    foundation_database(&path);
    let blocked = temp.path().join("not-a-folder");
    fs::write(&blocked, b"x").unwrap();

    let error = Database::open(&path, &blocked).err().unwrap();
    assert!(matches!(error, AppError::Backup { .. }), "{error:?}");

    let conn = Connection::open(&path).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), 1);
    let title: String = conn
        .query_row("SELECT title FROM studies WHERE id = ?1", [STUDY], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(title, "Romans 8:1–17");
    let bible_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'bible_books'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bible_tables, 0);
}
