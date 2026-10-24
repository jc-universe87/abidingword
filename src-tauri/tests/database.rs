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
    "bible_books",
    "bible_chapters",
    "bible_document_search",
    "bible_document_search_config",
    "bible_document_search_data",
    "bible_document_search_docsize",
    "bible_document_search_idx",
    "bible_document_segments",
    "bible_documents",
    "bible_entry_ids",
    "bible_lemma_entries",
    "bible_superscriptions",
    "bible_translations",
    "bible_verse_origins",
    "bible_verse_search",
    "bible_verse_search_config",
    "bible_verse_search_data",
    "bible_verse_search_docsize",
    "bible_verse_search_idx",
    "bible_verse_texts",
    "bible_verses",
    "bible_word_annotations",
    "bible_words",
    "finding_sources",
    "finding_tags",
    "findings",
    "library_search",
    "library_search_config",
    "library_search_data",
    "library_search_docsize",
    "library_search_idx",
    "passage_references",
    "presentation_items",
    "presentation_templates",
    "presentations",
    "projects",
    "schema_versions",
    "settings",
    "source_annotations",
    "source_files",
    "source_passages",
    "source_segments",
    "sources",
    "studies",
    "study_blocks",
    "study_relations",
    "study_search",
    "study_search_config",
    "study_search_content",
    "study_search_data",
    "study_search_docsize",
    "study_search_idx",
    "study_search_items",
    "study_sections",
    "study_templates",
    "teaching_finding_links",
    "teaching_materials",
    "teaching_passages",
    "teaching_points",
    "teaching_preparations",
    "teaching_templates",
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
                    ..Default::default()
                },
            )?;
            let section = &study.sections[2];
            sections::update(
                conn,
                &UpdateStudySection {
                    id: section.id.clone(),
                    title: Some("What I notice".into()),
                    ..Default::default()
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
        assert_eq!(
            detail.sections.len(),
            6,
            "the passage study starts with six parts"
        );
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

/// v0.18.7: a study's parts are given the phase v0.18.6 showed for them, by
/// key and kind of study; a part of the person's own stays without one, and
/// the person's own templates gain the same phases in the same order.
#[test]
fn migration_13_gives_existing_parts_and_own_templates_their_phases() {
    let mut conn = Connection::open_in_memory().unwrap();
    let before: Vec<_> = MIGRATIONS
        .iter()
        .filter(|m| m.version < 13)
        .map(|m| Migration {
            version: m.version,
            name: m.name,
            sql: m.sql,
        })
        .collect();
    migrations::run_with(&mut conn, &before).unwrap();
    conn.execute_batch(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('w', 'W', 1, 't', 't');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p', 'w', 'P', 't', 't');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES
             ('passage', 'p', 'A', 'passage', 't', 't'),
             ('doctrine', 'p', 'B', 'systematic_theology', 't', 't'),
             ('prep', 'p', 'C', 'teaching', 't', 't');
         INSERT INTO study_sections (id, study_id, key, title, position, created_at, updated_at) VALUES
             ('a1', 'passage', 'text', 'Text', 0, 't', 't'),
             ('a2', 'passage', NULL, 'My questions', 1, 't', 't'),
             ('a3', 'passage', 'structure', 'Shape', 2, 't', 't'),
             ('a4', 'passage', 'conclusions', 'Conclusions', 3, 't', 't'),
             ('a5', 'passage', 'something-else', 'Other', 4, 't', 't'),
             ('b1', 'doctrine', 'conclusions', 'Conclusions', 0, 't', 't'),
             ('c1', 'prep', 'structure', 'Structure', 0, 't', 't'),
             ('c2', 'prep', 'theology', 'Theology', 1, 't', 't');
         INSERT INTO study_templates (id, key, name, is_builtin, study_type, definition, created_at, updated_at) VALUES
             ('mine', 'user-mine', 'Mine', 0, 'teaching',
              '{\"sections\":[{\"key\":\"text\",\"title\":\"Text\"},{\"title\":\"Hymns\",\"guidance\":\"g\"},{\"key\":\"audience\",\"title\":\"Who\",\"optional\":true}]}',
              't', 't'),
             -- Damaged rows never stop the upgrade, and are left as they are.
             ('broken', 'user-broken', 'Broken', 0, 'custom', 'not json', 't', 't'),
             ('odd', 'user-odd', 'Odd', 0, 'custom', '{\"sections\":[\"loose\",3,{\"key\":\"theology\",\"title\":\"T\"}]}', 't', 't'),
             ('empty', 'user-empty', 'Empty', 0, 'custom', '{\"sections\":[]}', 't', 't');",
    )
    .unwrap();

    migrations::run(&mut conn).unwrap();

    let phase = |id: &str| -> Option<String> {
        conn.query_row(
            "SELECT phase FROM study_sections WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(phase("a1").as_deref(), Some("text"));
    assert_eq!(phase("a2"), None);
    assert_eq!(phase("a3").as_deref(), Some("text"));
    assert_eq!(phase("a4").as_deref(), Some("understanding"));
    assert_eq!(phase("a5"), None);
    assert_eq!(phase("b1").as_deref(), Some("theology"));
    assert_eq!(phase("c1").as_deref(), Some("teaching"));
    assert_eq!(phase("c2").as_deref(), Some("theology"));
    // Nothing else of a part changes.
    let title: String = conn
        .query_row(
            "SELECT title FROM study_sections WHERE id = 'a3'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(title, "Shape");

    let definition: String = conn
        .query_row(
            "SELECT definition FROM study_templates WHERE id = 'mine'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&definition).unwrap();
    assert_eq!(
        parsed,
        serde_json::json!({"sections": [
            {"key": "text", "title": "Text", "phase": "text"},
            {"title": "Hymns", "guidance": "g"},
            {"key": "audience", "title": "Who", "optional": true, "phase": "teaching"},
        ]})
    );
    let stored = |id: &str| -> String {
        conn.query_row(
            "SELECT definition FROM study_templates WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(stored("broken"), "not json");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stored("odd")).unwrap(),
        serde_json::json!({"sections": ["loose", 3, {"key": "theology", "title": "T", "phase": "theology"}]})
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stored("empty")).unwrap(),
        serde_json::json!({"sections": []})
    );
}
