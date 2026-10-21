//! Upgrading a v0.18.6 database (schema v12) to v14 (v0.18.7: phases of a
//! study's parts, Bible Teaching templates): backup first; every study part
//! keeps its text, place and key and is given the phase v0.18.6 showed for
//! it; parts of the person's own get none; teachings are untouched; no
//! teaching template appears by itself; a second start changes nothing. The
//! v12 database is written with plain SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{sections, teaching, teaching_templates, Database};
use abiding_word_lib::domain::StudyPhase;
use rusqlite::Connection;

const T: &str = "2026-10-20T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";

fn database_v12(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..12]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s-1', 'p-1', 'John 15', 'passage', '{T}', '{T}');
         INSERT INTO study_sections (id, study_id, key, title, guidance, position, created_at, updated_at) VALUES
           ('sec-1', 's-1', 'text', 'The words', 'The passage.', 0, '{T}', '{T}'),
           ('sec-2', 's-1', NULL, 'My questions', NULL, 1, '{T}', '{T}'),
           ('sec-3', 's-1', 'meaning', 'Meaning', NULL, 2, '{T}', '{T}');
         INSERT INTO study_blocks (id, section_id, block_type, position, content, created_at, updated_at) VALUES
           ('b-1', 'sec-2', 'paragraph', 0, 'Why a vine?', '{T}', '{T}');
         INSERT INTO teaching_preparations (id, study_id, title, kind, introduction, position, created_at, updated_at) VALUES
           ('tp-1', 's-1', 'Kids', 'children', 'Hello!', 0, '{T}', '{T}');
         INSERT INTO teaching_points (id, preparation_id, position, kind, title, explanation, created_at, updated_at) VALUES
           ('pt-1', 'tp-1', 0, 'activity', 'Grapes', 'Pass the grapes round.', '{T}', '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v12_database_is_backed_up_and_keeps_every_part_and_teaching() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v12(&path);

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
        .starts_with("abiding-word-v12-"));
    db.with_conn(|conn| {
        assert_eq!(
            migrations::current_version(conn)?,
            MIGRATIONS.last().unwrap().version
        );
        let parts = sections::list(conn, "s-1")?;
        assert_eq!(
            parts
                .iter()
                .map(|s| (
                    s.id.as_str(),
                    s.key.as_deref(),
                    s.title.as_str(),
                    s.position,
                    s.phase
                ))
                .collect::<Vec<_>>(),
            [
                (
                    "sec-1",
                    Some("text"),
                    "The words",
                    0,
                    Some(StudyPhase::Text)
                ),
                ("sec-2", None, "My questions", 1, None),
                (
                    "sec-3",
                    Some("meaning"),
                    "Meaning",
                    2,
                    Some(StudyPhase::Understanding)
                ),
            ]
        );
        assert_eq!(parts[0].guidance.as_deref(), Some("The passage."));
        assert_eq!(parts[1].blocks[0].content, "Why a vine?");
        let kids = teaching::get(conn, "tp-1")?;
        assert_eq!(kids.introduction, "Hello!");
        assert_eq!(
            (
                kids.points[0].kind.as_deref(),
                kids.points[0].title.as_str(),
                kids.points[0].explanation.as_str()
            ),
            (Some("activity"), "Grapes", "Pass the grapes round.")
        );
        assert!(teaching_templates::list(conn)?.is_empty());
        Ok(())
    })
    .unwrap();
    drop(db);

    // A second start finds nothing to do and makes no second backup.
    let db = Database::open(&path, &backups).unwrap();
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
    db.with_conn(|conn| {
        assert_eq!(sections::list(conn, "s-1")?[1].phase, None);
        Ok(())
    })
    .unwrap();
}
