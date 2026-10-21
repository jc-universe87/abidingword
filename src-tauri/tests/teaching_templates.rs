//! Bible Teaching templates of one's own (v0.18.7): a format and the points,
//! questions or steps a teaching starts with; structure only, copied into a
//! teaching when it is made and never linked to it afterwards. All text is
//! invented.

use abiding_word_lib::db::{projects, studies, teaching, teaching_templates, workspaces, Database};
use abiding_word_lib::domain::{
    CreateProject, CreateStudy, CreateTeaching, StartingPoint, TeachingTemplateInput,
    TeachingTemplatePoint, UpdateTeachingTemplate,
};
use abiding_word_lib::error::{AppError, AppResult};
use rusqlite::Connection;

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn step(key: Option<&str>, title: &str, kind: Option<&str>) -> TeachingTemplatePoint {
    TeachingTemplatePoint {
        key: key.map(Into::into),
        title: title.into(),
        kind: kind.map(Into::into),
    }
}

fn youth_evening() -> TeachingTemplateInput {
    TeachingTemplateInput {
        name: "Youth evening".into(),
        description: Some("Games first, then the Bible.".into()),
        kind: "children".into(),
        points: vec![
            step(Some("welcome"), "Welcome", Some("text")),
            step(None, "Game", Some("activity")),
            step(Some("story"), "Bible story", Some("scripture")),
            step(None, "", Some("question")),
        ],
    }
}

#[test]
fn a_template_keeps_its_format_and_its_steps_in_order() {
    with_db(|conn| {
        let mine = teaching_templates::create(conn, &youth_evening())?;
        assert_eq!(mine.kind, "children");
        assert_eq!(
            mine.description.as_deref(),
            Some("Games first, then the Bible.")
        );
        assert_eq!(
            mine.points,
            [
                step(Some("welcome"), "Welcome", Some("text")),
                step(None, "Game", Some("activity")),
                step(Some("story"), "Bible story", Some("scripture")),
                step(None, "", Some("question")),
            ]
        );
        assert_eq!(teaching_templates::list(conn)?, std::slice::from_ref(&mine));

        let edited = teaching_templates::update(
            conn,
            &UpdateTeachingTemplate {
                id: mine.id.clone(),
                template: TeachingTemplateInput {
                    name: "Youth night".into(),
                    points: vec![step(None, "Game", Some("activity"))],
                    ..youth_evening()
                },
            },
        )?;
        assert_eq!(edited.name, "Youth night");
        assert_eq!(edited.points.len(), 1);
        assert_eq!(edited.revision, mine.revision + 1);
        Ok(())
    });
}

#[test]
fn a_template_is_refused_without_a_format_or_with_a_wrong_kind_or_too_many_steps() {
    with_db(|conn| {
        let refused = |input: TeachingTemplateInput| {
            matches!(
                teaching_templates::create(conn, &input),
                Err(AppError::InvalidInput(_))
            )
        };
        assert!(refused(TeachingTemplateInput {
            kind: String::new(),
            ..youth_evening()
        }));
        assert!(refused(TeachingTemplateInput {
            kind: "concert".into(),
            ..youth_evening()
        }));
        assert!(refused(TeachingTemplateInput {
            points: vec![step(None, "Song", Some("audio-video"))],
            ..youth_evening()
        }));
        assert!(refused(TeachingTemplateInput {
            name: "  ".into(),
            ..youth_evening()
        }));
        assert!(refused(TeachingTemplateInput {
            points: vec![step(None, "x", None); 21],
            ..youth_evening()
        }));
        assert!(teaching_templates::list(conn)?.is_empty());
        Ok(())
    });
}

#[test]
fn editing_or_deleting_a_template_never_changes_a_teaching_made_from_it() {
    with_db(|conn| {
        let mine = teaching_templates::create(conn, &youth_evening())?;
        let workspace = workspaces::get_default(conn)?;
        let project = projects::create(
            conn,
            &CreateProject {
                workspace_id: workspace.id,
                title: "Kids".into(),
                description: None,
            },
        )?;
        let study = studies::create(
            conn,
            &CreateStudy {
                project_id: project.id,
                title: "John 15".into(),
                ..Default::default()
            },
        )?;
        // As the interface does: the template's steps become the teaching's own.
        let made = teaching::create(
            conn,
            &CreateTeaching {
                study_id: study.study.id.clone(),
                title: "Sunday kids".into(),
                kind: Some(mine.kind.clone()),
                points: mine
                    .points
                    .iter()
                    .map(|p| StartingPoint {
                        title: p.title.clone(),
                        kind: p.kind.clone(),
                    })
                    .collect(),
            },
        )?;
        let shape = |id: &str| -> AppResult<Vec<(String, Option<String>)>> {
            Ok(teaching::get(conn, id)?
                .points
                .into_iter()
                .map(|p| (p.title, p.kind))
                .collect())
        };
        let before = shape(&made.id)?;
        assert_eq!(before.len(), 4);

        teaching_templates::update(
            conn,
            &UpdateTeachingTemplate {
                id: mine.id.clone(),
                template: TeachingTemplateInput {
                    points: vec![],
                    ..youth_evening()
                },
            },
        )?;
        assert_eq!(shape(&made.id)?, before);
        teaching_templates::delete(conn, &mine.id)?;
        assert_eq!(shape(&made.id)?, before);
        assert!(teaching_templates::list(conn)?.is_empty());
        assert!(matches!(
            teaching_templates::get(conn, &mine.id),
            Err(AppError::NotFound { .. })
        ));
        assert!(matches!(
            teaching_templates::delete(conn, &mine.id),
            Err(AppError::NotFound { .. })
        ));
        Ok(())
    });
}
