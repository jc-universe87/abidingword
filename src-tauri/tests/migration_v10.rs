//! Upgrading a v0.17 database (schema v9) to v0.18 (v10, presentations):
//! backup first; studies, teachings with their steps, passages and kept
//! material exactly as before; no presentation made by itself; the new
//! tables usable; a second start changes nothing. The v9 database is
//! written with plain SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{presentations, studies, teaching, Database};
use abiding_word_lib::domain::{CreatePresentation, ProposalLabels};
use rusqlite::{Connection, OpenFlags};

const T: &str = "2026-10-17T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";

fn database_v9(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..9]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s-1', 'p-1', 'John 15', 'passage', '{T}', '{T}');
         INSERT INTO teaching_preparations (id, study_id, title, kind, introduction, central_message, position, created_at, updated_at) VALUES
           ('tp-1', 's-1', 'Kids church', 'children', 'Hello!', 'Jesus is the vine.', 0, '{T}', '{T}');
         INSERT INTO teaching_points (id, preparation_id, position, kind, title, explanation, created_at, updated_at) VALUES
           ('pt-1', 'tp-1', 0, 'scripture', 'Read it', '', '{T}', '{T}'),
           ('pt-2', 'tp-1', 1, 'activity', 'Draw a vine', 'Crayons on the tables.', '{T}', '{T}'),
           ('pt-3', 'tp-1', 2, 'question', 'What do branches need?', '', '{T}', '{T}');
         INSERT INTO teaching_passages (id, preparation_id, point_id, book, start_chapter, start_verse, end_chapter, end_verse, position, created_at) VALUES
           ('tpa-1', 'tp-1', 'pt-1', 'JHN', 15, 1, 15, 5, 0, '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v9_database_is_backed_up_keeps_its_teachings_and_gains_presentations() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v9(&path);

    let db = Database::open(&path, &backups).unwrap();
    let files: Vec<_> = fs::read_dir(&backups)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    let name = files[0].file_name().unwrap().to_str().unwrap().to_string();
    assert!(name.starts_with("abiding-word-v9-"), "{name}");
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 9);

    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, MIGRATIONS.len() as i64);
        studies::get_detail(conn, "s-1")?;
        let prep = teaching::get(conn, "tp-1")?;
        assert_eq!(prep.introduction, "Hello!");
        let steps: Vec<_> = prep
            .points
            .iter()
            .map(|p| (p.title.as_str(), p.kind.as_deref()))
            .collect();
        assert_eq!(
            steps,
            [
                ("Read it", Some("scripture")),
                ("Draw a vine", Some("activity")),
                ("What do branches need?", Some("question"))
            ]
        );
        assert_eq!(prep.passages[0].reference.canonical, "JHN.15.1-JHN.15.5");
        // Nothing is made by itself.
        assert!(presentations::list(conn, "tp-1")?.is_empty());
        // The new tables work with the old teaching.
        let p = presentations::create(
            conn,
            &CreatePresentation {
                preparation_id: "tp-1".into(),
                title: None,
                propose: true,
                labels: ProposalLabels {
                    introduction: "Welcome".into(),
                    conclusion: "Goodbye".into(),
                },
            },
        )?;
        let kinds: Vec<&str> = p.items.iter().map(|i| i.kind.as_str()).collect();
        assert_eq!(
            kinds,
            [
                "title",
                "heading",
                "text",
                "scripture",
                "activity",
                "question"
            ]
        );
        // Making a presentation leaves the teaching as it was.
        assert_eq!(teaching::get(conn, "tp-1")?.revision, prep.revision);
        Ok(())
    })
    .unwrap();
    drop(db);
    let again = Database::open(&path, &backups).unwrap();
    assert_eq!(
        fs::read_dir(&backups).unwrap().count(),
        1,
        "no second backup"
    );
    again
        .with_conn(|conn| {
            assert_eq!(presentations::list(conn, "tp-1")?.len(), 1);
            Ok(())
        })
        .unwrap();
}
