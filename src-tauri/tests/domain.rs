//! Project → Study → Section → Block relationships and validation.

use abiding_word_lib::db::{
    blocks, projects, sections, settings, studies, templates, workspaces, Database,
};
use abiding_word_lib::domain::{
    BlockType, CreateProject, CreateStudy, CreateStudyBlock, ListStudies, Project, Theme,
    UpdateProject, UpdateSettings, UpdateStudy, UpdateStudyBlock,
};
use abiding_word_lib::error::{AppError, AppResult};
use rusqlite::Connection;

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn new_project(conn: &Connection, title: &str) -> AppResult<Project> {
    let workspace = workspaces::get_default(conn)?;
    projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: title.into(),
            description: None,
        },
    )
}

fn new_study(conn: &Connection, project_id: &str, title: &str) -> AppResult<String> {
    Ok(studies::create(
        conn,
        &CreateStudy {
            project_id: project_id.into(),
            title: title.into(),
            template_key: None,
            ..Default::default()
        },
    )?
    .study
    .id)
}

#[test]
fn studies_belong_to_their_project() {
    with_db(|conn| {
        let romans = new_project(conn, "Romans Sermon Series")?;
        let genesis = new_project(conn, "Genesis Bible Study")?;
        new_study(conn, &romans.id, "Romans 8:1–17")?;
        new_study(conn, &romans.id, "Romans 8:18–30")?;
        new_study(conn, &genesis.id, "Genesis 1")?;

        let romans_studies = studies::list(
            conn,
            &ListStudies {
                project_id: Some(romans.id.clone()),
                ..Default::default()
            },
        )?;
        assert_eq!(romans_studies.len(), 2);
        assert!(romans_studies.iter().all(|s| s.project_id == romans.id));
        assert_eq!(
            studies::list(
                conn,
                &ListStudies {
                    project_id: Some(genesis.id.clone()),
                    ..Default::default()
                }
            )?
            .len(),
            1
        );
        assert_eq!(projects::get(conn, &romans.id)?.study_count, 2);
        Ok(())
    });
}

#[test]
fn a_new_study_gets_the_template_sections_in_order() {
    with_db(|conn| {
        let project = new_project(conn, "Romans")?;
        let study_id = new_study(conn, &project.id, "Romans 8:1–17")?;

        let found = sections::list(conn, &study_id)?;
        let titles: Vec<_> = found.iter().map(|s| s.title.as_str()).collect();
        let template = &templates::builtin_definitions()?[0];
        let expected: Vec<_> = template.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, expected);
        assert_eq!(
            titles,
            [
                "Text",
                "Context",
                "Observations",
                "Structure",
                "Exegesis",
                "Theology",
                "Application",
                "Audience",
                "Teaching"
            ]
        );
        for (index, section) in found.iter().enumerate() {
            assert_eq!(section.study_id, study_id);
            assert_eq!(section.position, index as i64);
            assert_eq!(section.blocks.len(), 1);
            assert_eq!(section.blocks[0].block_type, BlockType::Paragraph);
        }
        Ok(())
    });
}

#[test]
fn blocks_can_be_added_edited_and_removed() {
    with_db(|conn| {
        let project = new_project(conn, "Romans")?;
        let study_id = new_study(conn, &project.id, "Romans 8")?;
        let section = &sections::list(conn, &study_id)?[2];

        let note = blocks::create(
            conn,
            &CreateStudyBlock {
                section_id: section.id.clone(),
                block_type: BlockType::Note,
                content: None,
            },
        )?;
        assert_eq!(note.position, 1);

        let edited = blocks::update(
            conn,
            &UpdateStudyBlock {
                id: note.id.clone(),
                content: Some("“No condemnation” — note the therefore.".into()),
            },
        )?;
        assert_eq!(edited.revision, 2);

        blocks::delete(conn, &section.blocks[0].id)?;
        let after = sections::get(conn, &section.id)?;
        assert_eq!(after.blocks.len(), 1);
        assert_eq!(
            after.blocks[0].content,
            "“No condemnation” — note the therefore."
        );
        Ok(())
    });
}

#[test]
fn titles_can_be_updated_and_revisions_increase() {
    with_db(|conn| {
        let project = new_project(conn, "Romans")?;
        let study_id = new_study(conn, &project.id, "Draft")?;

        let study = studies::update(
            conn,
            &UpdateStudy {
                id: study_id,
                title: Some("  Romans 8:1–17 ".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(study.title, "Romans 8:1–17");
        assert_eq!(study.revision, 2);

        let project = projects::update(
            conn,
            &UpdateProject {
                id: project.id,
                title: None,
                description: Some("Autumn series".into()),
            },
        )?;
        assert_eq!(project.title, "Romans");
        assert_eq!(project.description.as_deref(), Some("Autumn series"));
        Ok(())
    });
}

#[test]
fn invalid_input_and_missing_records_are_reported_clearly() {
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        let blank = new_project(conn, "   ").unwrap_err();
        assert!(matches!(blank, AppError::InvalidInput(_)));

        let missing = studies::create(
            conn,
            &CreateStudy {
                project_id: "00000000-0000-4000-8000-000000000000".into(),
                title: "Orphan".into(),
                template_key: None,
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(
            missing,
            AppError::NotFound {
                entity: "project",
                ..
            }
        ));
        Ok(())
    })
    .unwrap();
}

#[test]
fn deleted_blocks_are_kept_in_the_file_but_hidden() {
    with_db(|conn| {
        let project = new_project(conn, "Romans")?;
        let study_id = new_study(conn, &project.id, "Romans 8")?;
        let block_id = sections::list(conn, &study_id)?[0].blocks[0].id.clone();

        blocks::delete(conn, &block_id)?;

        assert!(matches!(
            blocks::get(conn, &block_id),
            Err(AppError::NotFound { .. })
        ));
        let kept: i64 = conn.query_row(
            "SELECT COUNT(*) FROM study_blocks WHERE id = ?1 AND deleted_at IS NOT NULL",
            [&block_id],
            |r| r.get(0),
        )?;
        assert_eq!(kept, 1);
        Ok(())
    });
}

#[test]
fn theme_setting_defaults_to_light_and_persists() {
    with_db(|conn| {
        assert_eq!(settings::get(conn)?.theme, Theme::Light);
        settings::update(
            conn,
            &UpdateSettings {
                theme: Some(Theme::Dark),
                ..Default::default()
            },
        )?;
        assert_eq!(settings::get(conn)?.theme, Theme::Dark);
        Ok(())
    });
}

#[test]
fn builtin_templates_are_installed_once() {
    with_db(|conn| {
        templates::ensure_builtin(conn)?;
        templates::ensure_builtin(conn)?;
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM study_templates", [], |r| r.get(0))?;
        assert_eq!(count, 6, "the six built-in templates");
        let rewritten: i64 = conn.query_row(
            "SELECT COUNT(*) FROM study_templates WHERE revision <> 1",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(rewritten, 0, "unchanged templates must not be rewritten");
        Ok(())
    });
}
