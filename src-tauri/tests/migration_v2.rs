//! Upgrading a Foundation (schema v1) database to the Scripture schema (v2).

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{annotations, projects, sections, studies, workspaces, Database};
use abiding_word_lib::domain::{CreateProject, CreateStudy, UpdateStudySection};
use abiding_word_lib::error::AppError;
use abiding_word_lib::scripture::reference::ScriptureRef;
use rusqlite::{Connection, OpenFlags};

struct V1 {
    workspace_id: String,
    project_id: String,
    study_id: String,
    section_id: String,
}

/// A database exactly as Foundation v0.1 would leave it, with a project, a
/// study, a renamed section, a study passage and an old-style annotation.
fn foundation_database(path: &Path) -> V1 {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..1]).unwrap();
    workspaces::ensure_default(&conn).unwrap();
    abiding_word_lib::db::templates::ensure_builtin(&conn).unwrap();
    let workspace = workspaces::get_default(&conn).unwrap();
    let project = projects::create(
        &conn,
        &CreateProject {
            workspace_id: workspace.id.clone(),
            title: "Romans Sermon Series".into(),
            description: None,
        },
    )
    .unwrap();
    let study = studies::create(
        &conn,
        &CreateStudy {
            project_id: project.id.clone(),
            title: "Romans 8:1–17".into(),
            template_key: None,
        },
    )
    .unwrap();
    let section_id = study.sections[2].id.clone();
    sections::update(
        &conn,
        &UpdateStudySection {
            id: section_id.clone(),
            title: Some("What I notice".into()),
        },
    )
    .unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO passage_references (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, label, created_at, updated_at)
         VALUES ('p1', '{s}', 'ROM', 8, 1, 8, 17, 'Romans 8:1–17', 'now', 'now');
         INSERT INTO annotations (id, workspace_id, passage_reference_id, kind, content, created_at, updated_at)
         VALUES ('a1', '{w}', 'p1', 'note', 'Old note', 'now', 'now');",
        s = study.study.id,
        w = workspace.id
    ))
    .unwrap();
    V1 {
        workspace_id: workspace.id,
        project_id: project.id,
        study_id: study.study.id,
        section_id,
    }
}

#[test]
fn a_foundation_database_upgrades_with_a_backup_and_keeps_its_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("backups").join("pre-migration");
    let v1 = foundation_database(&path);

    let db = Database::open(&path, &backups).unwrap();

    // Backup first, holding the v1 state.
    let files: Vec<_> = fs::read_dir(&backups)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 1);
    assert_eq!(
        projects::get(&copy, &v1.project_id).unwrap().title,
        "Romans Sermon Series"
    );

    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, 2);
        assert_eq!(workspaces::get_default(conn)?.id, v1.workspace_id);
        assert_eq!(projects::get(conn, &v1.project_id)?.study_count, 1);
        assert_eq!(studies::get(conn, &v1.study_id)?.title, "Romans 8:1–17");
        assert_eq!(sections::get(conn, &v1.section_id)?.title, "What I notice");
        assert_eq!(sections::list(conn, &v1.study_id)?.len(), 9);
        let books: i64 = conn.query_row("SELECT COUNT(*) FROM bible_books", [], |r| r.get(0))?;
        assert_eq!(books, 66);

        // The old annotation was carried into the new shape.
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
    let v1 = foundation_database(&path);
    let blocked = temp.path().join("not-a-folder");
    fs::write(&blocked, b"x").unwrap();

    let error = Database::open(&path, &blocked).err().unwrap();
    assert!(matches!(error, AppError::Backup { .. }), "{error:?}");

    let conn = Connection::open(&path).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), 1);
    assert_eq!(
        studies::get(&conn, &v1.study_id).unwrap().title,
        "Romans 8:1–17"
    );
    let bible_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'bible_books'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bible_tables, 0);
}
