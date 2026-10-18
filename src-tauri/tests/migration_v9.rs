//! Upgrading a v0.16 database (schema v8) to v0.17 (v9, kinds of teaching
//! steps): backup first; studies, parts, writing, notes, templates and
//! teaching preparations exactly as before; existing points without a kind;
//! the new column usable. The v8 database is written with plain SQL; all
//! text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{findings, sections, studies, teaching, templates, Database};
use abiding_word_lib::domain::{
    CreateTeaching, CreateTeachingPoint, StartingPoint, UpdateTeachingPoint,
};
use abiding_word_lib::error::AppError;
use rusqlite::{Connection, OpenFlags};

const T: &str = "2026-10-17T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";

fn database_v8(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..8]).unwrap();
    // A study made with the old nine-part passage template, a note in one of
    // its parts, a user template, and a sermon with two points and kept material.
    conn.execute_batch(&format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p-1', '{W}', 'Collection', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s-1', 'p-1', 'John 15', 'passage', '{T}', '{T}');
         INSERT INTO study_sections (id, study_id, key, title, guidance, position, created_at, updated_at) VALUES
           ('sec-1', 's-1', 'exegesis', 'Exegesis', 'What did the text mean for its first readers?', 0, '{T}', '{T}'),
           ('sec-2', 's-1', 'audience', 'Audience', NULL, 1, '{T}', '{T}');
         INSERT INTO study_blocks (id, section_id, block_type, position, content, created_at, updated_at) VALUES
           ('b-1', 'sec-1', 'paragraph', 0, 'Remain means stay joined.', '{T}', '{T}');
         INSERT INTO findings (id, study_id, section_id, kind, content, created_at, updated_at) VALUES
           ('f-1', 's-1', 'sec-2', 'question', 'Who is listening?', '{T}', '{T}');
         INSERT INTO study_templates (id, key, name, study_type, is_builtin, definition, created_at, updated_at) VALUES
           ('t-1', 'user-t-1', 'Mine', 'passage', 0, '{{\"sections\":[{{\"title\":\"Prayer\"}}]}}', '{T}', '{T}');
         INSERT INTO teaching_preparations (id, study_id, title, kind, introduction, position, created_at, updated_at) VALUES
           ('tp-1', 's-1', 'Sunday', 'sermon', 'Have you pruned a rose?', 0, '{T}', '{T}');
         INSERT INTO teaching_points (id, preparation_id, position, title, explanation, created_at, updated_at) VALUES
           ('pt-1', 'tp-1', 0, 'Stay connected', 'Branches live from the vine.', '{T}', '{T}'),
           ('pt-2', 'tp-1', 1, 'Bear fruit', '', '{T}', '{T}');
         INSERT INTO teaching_materials (id, preparation_id, point_id, kind, standing, title, content, position, created_at) VALUES
           ('m-1', 'tp-1', 'pt-1', 'illustration', 'hypothetical', 'A vine', 'Picture a vine.', 0, '{T}');"
    ))
    .unwrap();
}

#[test]
fn a_v8_database_is_backed_up_and_keeps_everything() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v8(&path);

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
        .starts_with("abiding-word-v8-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 8);

    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn)?, MIGRATIONS.len() as i64);
        // The study keeps its old parts (even ones the new templates retire), writing and notes.
        let detail = studies::get_detail(conn, "s-1")?;
        let titles: Vec<_> = detail.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["Exegesis", "Audience"]);
        assert_eq!(
            sections::get(conn, "sec-1")?.blocks[0].content,
            "Remain means stay joined."
        );
        let note = findings::get(conn, "f-1")?;
        assert_eq!(
            (note.content.as_str(), note.section_id.as_deref()),
            ("Who is listening?", Some("sec-2"))
        );
        // The person's template is untouched.
        assert_eq!(templates::get(conn, "t-1")?.sections[0].title, "Prayer");
        // The sermon, its points and kept material as before; the points have no kind.
        let prep = teaching::get(conn, "tp-1")?;
        assert_eq!(prep.introduction, "Have you pruned a rose?");
        assert_eq!(prep.points.len(), 2);
        assert!(prep.points.iter().all(|p| p.kind.is_none()));
        assert_eq!(prep.points[0].explanation, "Branches live from the vine.");
        assert_eq!(prep.materials[0].title, "A vine");
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

#[test]
fn a_lesson_starts_with_its_steps_and_each_step_can_say_its_kind() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    database_v8(&path);
    let db = Database::open(&path, &backups).unwrap();
    db.with_conn(|conn| {
        let step = |title: &str, kind: &str| StartingPoint {
            title: title.into(),
            kind: Some(kind.into()),
        };
        let lesson = teaching::create(
            conn,
            &CreateTeaching {
                study_id: "s-1".into(),
                title: "Kids' church".into(),
                kind: Some("children".into()),
                points: vec![
                    step("Welcome", "text"),
                    step("The vine", "scripture"),
                    step("Draw a vine", "activity"),
                ],
            },
        )?;
        let kinds: Vec<_> = lesson
            .points
            .iter()
            .map(|p| (p.title.as_str(), p.kind.as_deref()))
            .collect();
        assert_eq!(
            kinds,
            [
                ("Welcome", Some("text")),
                ("The vine", Some("scripture")),
                ("Draw a vine", Some("activity"))
            ]
        );

        // A new step with a kind, after the second; and a kind changed, then cleared.
        let lesson = teaching::create_point(
            conn,
            &CreateTeachingPoint {
                preparation_id: lesson.id.clone(),
                title: Some("What do branches need?".into()),
                kind: Some("question".into()),
                after_point_id: Some(lesson.points[1].id.clone()),
            },
        )?;
        assert_eq!(lesson.points[2].kind.as_deref(), Some("question"));
        let id = lesson.points[0].id.clone();
        let lesson = teaching::update_point(
            conn,
            &UpdateTeachingPoint {
                id: id.clone(),
                kind: Some("image".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(lesson.points[0].kind.as_deref(), Some("image"));
        assert_eq!(
            lesson.points[0].title, "Welcome",
            "the rest of the step is kept"
        );
        let lesson = teaching::update_point(
            conn,
            &UpdateTeachingPoint {
                id,
                kind: Some(String::new()),
                ..Default::default()
            },
        )?;
        assert_eq!(lesson.points[0].kind, None);

        // Only known kinds of step.
        let wrong = teaching::update_point(
            conn,
            &UpdateTeachingPoint {
                id: lesson.points[0].id.clone(),
                kind: Some("dance".into()),
                ..Default::default()
            },
        );
        assert!(matches!(wrong, Err(AppError::InvalidInput(_))));
        let too_many = teaching::create(
            conn,
            &CreateTeaching {
                study_id: "s-1".into(),
                title: "Long".into(),
                kind: Some("lesson".into()),
                points: (0..21)
                    .map(|n| step(&format!("Step {n}"), "text"))
                    .collect(),
            },
        );
        assert!(matches!(too_many, Err(AppError::InvalidInput(_))));
        Ok(())
    })
    .unwrap();
}
