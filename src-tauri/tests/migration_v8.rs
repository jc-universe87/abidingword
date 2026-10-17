//! Upgrading a v0.15 database (schema v7) to v0.16 (v8, teaching
//! preparations): backup first, existing studies and findings exactly as
//! before, and the new tables empty and usable. The v7 database is written
//! with plain SQL; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{findings, studies, teaching, Database};
use abiding_word_lib::domain::{CreateTeaching, LinkTeachingFinding};
use rusqlite::{Connection, OpenFlags};

const T: &str = "2026-10-16T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";

fn database_v7(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..7]).unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s-1', 'p-1', 'Abiding', 'teaching', '{T}', '{T}');
         INSERT INTO findings (id, study_id, kind, content, created_at, updated_at) VALUES ('f-1', 's-1', 'teaching_idea', 'Start with the vineyard.', '{T}', '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v7_database_is_backed_up_and_gains_empty_teaching_tables() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v7(&path);

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
        .starts_with("abiding-word-v7-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 7);

    db.with_conn(|conn| {
        assert_eq!(
            migrations::current_version(conn)?,
            MIGRATIONS.last().unwrap().version
        );
        assert_eq!(studies::get(conn, "s-1")?.title, "Abiding");
        assert_eq!(
            findings::get(conn, "f-1")?.content,
            "Start with the vineyard."
        );
        assert!(teaching::list(conn, "s-1")?.is_empty());
        for table in [
            "teaching_preparations",
            "teaching_points",
            "teaching_finding_links",
            "teaching_passages",
            "teaching_materials",
        ] {
            let n: i64 =
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?;
            assert_eq!(n, 0, "{table} starts empty");
        }
        // Usable straight away, with the old finding.
        let prep = teaching::create(
            conn,
            &CreateTeaching {
                study_id: "s-1".into(),
                title: "Sunday".into(),
                kind: None,
                points: Vec::new(),
            },
        )?;
        let prep = teaching::link_finding(
            conn,
            &LinkTeachingFinding {
                preparation_id: prep.id,
                point_id: None,
                finding_id: "f-1".into(),
            },
        )?;
        assert_eq!(prep.findings[0].finding.content, "Start with the vineyard.");
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
    drop(again);
}
