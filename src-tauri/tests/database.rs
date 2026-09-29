//! Database creation, migrations and persistence across restarts.

use abiding_word_lib::db::migrations::{self, Migration, MIGRATIONS};
use abiding_word_lib::db::{projects, sections, studies, workspaces, Database};
use abiding_word_lib::domain::{CreateProject, CreateStudy, UpdateStudySection};
use abiding_word_lib::error::AppError;
use abiding_word_lib::filesystem::DataDirs;
use rusqlite::Connection;

fn backups(temp: &tempfile::TempDir) -> std::path::PathBuf {
    temp.path().join("backups")
}

const EXPECTED_TABLES: &[&str] = &[
    "annotations",
    "findings",
    "passage_references",
    "projects",
    "schema_versions",
    "settings",
    "source_files",
    "source_segments",
    "sources",
    "studies",
    "study_blocks",
    "study_sections",
    "study_templates",
    "workspaces",
];

fn table_names(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn database_file_is_created_inside_the_data_directory() {
    let temp = tempfile::tempdir().unwrap();
    let dirs = DataDirs::ensure(temp.path().join("Abiding Word")).unwrap();
    let path = dirs.database_file();
    assert!(!path.exists());

    let db = Database::open(&path, &backups(&temp)).unwrap();

    assert!(path.is_file());
    assert_eq!(db.path(), Some(path.as_path()));
}

#[test]
fn migrations_create_the_full_schema_and_record_the_version() {
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        assert_eq!(table_names(conn), EXPECTED_TABLES);
        let latest = MIGRATIONS.last().unwrap().version;
        assert_eq!(migrations::current_version(conn)?, latest);
        Ok(())
    })
    .unwrap();
}

#[test]
fn reopening_is_idempotent_and_keeps_one_default_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("test.db");

    let first = Database::open(&path, &backups(&temp))
        .unwrap()
        .with_conn(workspaces::get_default)
        .unwrap();
    let db = Database::open(&path, &backups(&temp)).unwrap();
    let second = db.with_conn(workspaces::get_default).unwrap();

    assert_eq!(first.id, second.id);
    let count: i64 = db
        .with_conn(|c| Ok(c.query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(count, 1);
    let versions: i64 = db
        .with_conn(|c| Ok(c.query_row("SELECT COUNT(*) FROM schema_versions", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(versions, MIGRATIONS.len() as i64);
}

#[test]
fn project_study_and_section_survive_a_restart() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("test.db");

    let (project_id, study_id, section_id) = {
        let db = Database::open(&path, &backups(&temp)).unwrap();
        db.with_conn(|conn| {
            let workspace = workspaces::get_default(conn)?;
            let project = projects::create(
                conn,
                &CreateProject {
                    workspace_id: workspace.id,
                    title: "Romans Sermon Series".into(),
                    description: None,
                },
            )?;
            let study = studies::create(
                conn,
                &CreateStudy {
                    project_id: project.id.clone(),
                    title: "Romans 8:1–17".into(),
                    template_key: None,
                },
            )?;
            let section = &study.sections[2];
            sections::update(
                conn,
                &UpdateStudySection {
                    id: section.id.clone(),
                    title: Some("What I notice".into()),
                },
            )?;
            Ok((project.id, study.study.id, section.id.clone()))
        })
        .unwrap()
        // `db` is dropped here, closing the file like quitting the app.
    };

    let db = Database::open(&path, &backups(&temp)).unwrap();
    db.with_conn(|conn| {
        assert_eq!(
            projects::get(conn, &project_id)?.title,
            "Romans Sermon Series"
        );
        let detail = studies::get_detail(conn, &study_id)?;
        assert_eq!(detail.study.title, "Romans 8:1–17");
        assert_eq!(detail.sections.len(), 9);
        let section = sections::get(conn, &section_id)?;
        assert_eq!(section.title, "What I notice");
        assert_eq!(section.revision, 2);
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_database_from_a_newer_app_version_is_refused() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO schema_versions (version, name, applied_at) VALUES (999, 'future', 'x')",
        [],
    )
    .unwrap();

    let error = migrations::run(&mut conn).unwrap_err();
    assert!(matches!(error, AppError::Migration { version: 999, .. }));
}

#[test]
fn a_failing_migration_is_rolled_back_and_reported() {
    let mut conn = Connection::open_in_memory().unwrap();
    let broken = [
        Migration {
            version: 1,
            name: "good",
            sql: "CREATE TABLE a (id INTEGER);",
        },
        Migration {
            version: 2,
            name: "bad",
            sql: "CREATE TABLE b (id INTEGER); THIS IS NOT SQL;",
        },
    ];

    let error = migrations::run_with(&mut conn, &broken).unwrap_err();

    assert!(matches!(error, AppError::Migration { version: 2, .. }));
    assert_eq!(migrations::current_version(&conn).unwrap(), 1);
    let names = table_names(&conn);
    assert!(names.contains(&"a".to_string()));
    assert!(
        !names.contains(&"b".to_string()),
        "partial migration was kept"
    );
}

#[test]
fn new_migrations_apply_on_top_of_an_existing_database() {
    let mut conn = Connection::open_in_memory().unwrap();
    let one = || Migration {
        version: 1,
        name: "one",
        sql: "CREATE TABLE a (id INTEGER);",
    };
    let v1 = [one()];
    let v2 = [
        one(),
        Migration {
            version: 2,
            name: "two",
            sql: "ALTER TABLE a ADD COLUMN note TEXT;",
        },
    ];

    migrations::run_with(&mut conn, &v1).unwrap();
    let report = migrations::run_with(&mut conn, &v2).unwrap();

    assert_eq!(report.from_version, 1);
    assert_eq!(report.to_version, 2);
    assert_eq!(report.applied, vec![2]);
}
