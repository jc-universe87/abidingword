//! Studies v0.3: types, status, sections, templates, duplication, relations.

use abiding_word_lib::db::{
    blocks, findings, projects, relations, sections, studies, study_passages, templates,
    workspaces, Database,
};
use abiding_word_lib::domain::{
    CreateFinding, CreateProject, CreateStudy, CreateStudyRelation, CreateStudySection,
    DeleteStudySection, DuplicateStudy, FindingType, ListStudies, PassageRole, RelationType,
    Reorder, StudyDetails, StudyStatus, StudyType, TemplateInput, TemplateSection, UpdateStudy,
    UpdateStudyBlock, UpdateTemplate,
};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::scripture::AddStudyPassage;
use rusqlite::Connection;

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn project(conn: &Connection, title: &str) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    Ok(projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: title.into(),
            description: None,
        },
    )?
    .id)
}

fn study(
    conn: &Connection,
    project_id: &str,
    title: &str,
    study_type: StudyType,
) -> AppResult<String> {
    Ok(studies::create(
        conn,
        &CreateStudy {
            project_id: project_id.into(),
            title: title.into(),
            study_type: Some(study_type),
            ..Default::default()
        },
    )?
    .study
    .id)
}

fn section_titles(conn: &Connection, study_id: &str) -> AppResult<Vec<String>> {
    Ok(sections::list(conn, study_id)?
        .into_iter()
        .map(|s| s.title)
        .collect())
}

// --- study types -----------------------------------------------------------

#[test]
fn every_study_type_gets_its_scaffold_and_persists() {
    with_db(|conn| {
        let p = project(conn, "All kinds")?;
        let expected = [
            (StudyType::Passage, "Text", 9),
            (StudyType::Word, "Word", 7),
            (StudyType::Topical, "Question / Topic", 8),
            (StudyType::BiblicalTheology, "Theme", 8),
            (StudyType::SystematicTheology, "Doctrine", 8),
            (StudyType::Teaching, "Text", 10),
            (StudyType::Custom, "Notes", 1),
        ];
        for (study_type, first_section, count) in expected {
            let id = study(conn, &p, study_type.as_str(), study_type)?;
            let stored = studies::get(conn, &id)?;
            assert_eq!(stored.study_type, study_type);
            assert_eq!(stored.status, StudyStatus::Active);
            let titles = section_titles(conn, &id)?;
            assert_eq!(titles.len(), count, "{study_type:?}");
            assert_eq!(titles[0], first_section, "{study_type:?}");
        }
        assert_eq!(StudyType::ALL.len(), 7);
        assert!(matches!(
            StudyType::parse("sermonic"),
            Err(AppError::InvalidInput(_))
        ));
        Ok(())
    });
}

#[test]
fn a_study_can_start_with_a_primary_passage_or_none() {
    with_db(|conn| {
        let p = project(conn, "John")?;
        let vine = studies::create(
            conn,
            &CreateStudy {
                project_id: p.clone(),
                title: "The True Vine".into(),
                primary_passage: Some("JHN.15.1-JHN.15.11".into()),
                ..Default::default()
            },
        )?;
        let passages = study_passages::list(conn, &vine.study.id)?;
        assert_eq!(passages.len(), 1);
        assert_eq!(
            (passages[0].role, passages[0].reference.display.as_str()),
            (PassageRole::Primary, "John 15:1–11")
        );

        let prayer = study(conn, &p, "Prayer", StudyType::Topical)?;
        assert!(study_passages::list(conn, &prayer)?.is_empty());

        assert!(matches!(
            studies::create(
                conn,
                &CreateStudy {
                    project_id: p,
                    title: "Bad".into(),
                    primary_passage: Some("JHN.99".into()),
                    ..Default::default()
                }
            ),
            Err(AppError::InvalidReference(_))
        ));
        Ok(())
    });
}

#[test]
fn metadata_status_and_details_update_and_list_filters_work() {
    with_db(|conn| {
        let a = project(conn, "A")?;
        let b = project(conn, "B")?;
        let word = study(conn, &a, "δικαιοσύνη", StudyType::Word)?;
        study(conn, &a, "Romans 8", StudyType::Passage)?;
        study(conn, &b, "Prayer", StudyType::Topical)?;

        let updated = studies::update(
            conn,
            &UpdateStudy {
                id: word.clone(),
                status: Some(StudyStatus::Completed),
                description: Some("How Paul uses righteousness".into()),
                details: Some(StudyDetails {
                    lemma: Some("δικαιοσύνη".into()),
                    original_language: Some("grc".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(updated.status, StudyStatus::Completed);
        assert_eq!(updated.details.lemma.as_deref(), Some("δικαιοσύνη"));
        assert_eq!(updated.revision, 2);

        let all = studies::list(conn, &ListStudies::default())?;
        assert_eq!(all.len(), 3);
        let in_a = studies::list(
            conn,
            &ListStudies {
                project_id: Some(a.clone()),
                ..Default::default()
            },
        )?;
        assert_eq!(in_a.len(), 2);
        let words = studies::list(
            conn,
            &ListStudies {
                study_type: Some(StudyType::Word),
                ..Default::default()
            },
        )?;
        assert_eq!(
            words.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(),
            ["δικαιοσύνη"]
        );
        let done = studies::list(
            conn,
            &ListStudies {
                status: Some(StudyStatus::Completed),
                ..Default::default()
            },
        )?;
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].project_title, "A");
        Ok(())
    });
}

// --- sections --------------------------------------------------------------

#[test]
fn sections_can_be_added_renamed_reordered_and_removed() {
    with_db(|conn| {
        let p = project(conn, "John")?;
        let s = study(conn, &p, "Notes", StudyType::Custom)?;
        let extra = sections::create(
            conn,
            &CreateStudySection {
                study_id: s.clone(),
                title: "Questions".into(),
                guidance: Some("Open questions".into()),
            },
        )?;
        assert_eq!(extra.blocks.len(), 1);
        assert_eq!(section_titles(conn, &s)?, ["Notes", "Questions"]);

        let ids: Vec<String> = sections::list(conn, &s)?
            .into_iter()
            .map(|x| x.id)
            .rev()
            .collect();
        sections::reorder(
            conn,
            &Reorder {
                parent_id: s.clone(),
                ids,
            },
        )?;
        assert_eq!(section_titles(conn, &s)?, ["Questions", "Notes"]);

        let stale = sections::reorder(
            conn,
            &Reorder {
                parent_id: s.clone(),
                ids: vec![extra.id.clone()],
            },
        );
        assert!(matches!(stale, Err(AppError::InvalidInput(_))));

        sections::delete(
            conn,
            &DeleteStudySection {
                id: extra.id,
                force: false,
            },
        )?;
        assert_eq!(section_titles(conn, &s)?, ["Notes"]);
        Ok(())
    });
}

#[test]
fn a_section_with_content_needs_confirmation_and_its_findings_are_kept() {
    with_db(|conn| {
        let p = project(conn, "John")?;
        let s = study(conn, &p, "John 15", StudyType::Passage)?;
        let context = sections::list(conn, &s)?[1].clone();
        blocks::update(
            conn,
            &UpdateStudyBlock {
                id: context.blocks[0].id.clone(),
                content: Some("Upper room discourse.".into()),
            },
        )?;
        let finding = findings::create(
            conn,
            &CreateFinding {
                study_id: s.clone(),
                finding_type: FindingType::Observation,
                content: Some("Chapter 14 ends with 'Arise'.".into()),
                section_id: Some(context.id.clone()),
                passage: None,
            },
        )?;

        let refused = sections::delete(
            conn,
            &DeleteStudySection {
                id: context.id.clone(),
                force: false,
            },
        );
        match refused {
            Err(AppError::Conflict(message)) => assert!(message.contains("Context")),
            other => panic!("{other:?}"),
        }
        sections::delete(
            conn,
            &DeleteStudySection {
                id: context.id.clone(),
                force: true,
            },
        )?;
        assert!(!section_titles(conn, &s)?.contains(&"Context".to_string()));
        let kept = findings::get(conn, &finding.id)?;
        assert_eq!(kept.section_id, None, "the finding stays, now study-level");
        Ok(())
    });
}

#[test]
fn blocks_support_quotations_and_questions_and_can_be_reordered() {
    use abiding_word_lib::domain::{BlockType, CreateStudyBlock};
    with_db(|conn| {
        let p = project(conn, "John")?;
        let s = study(conn, &p, "Notes", StudyType::Custom)?;
        let section = sections::list(conn, &s)?[0].clone();
        let quote = blocks::create(
            conn,
            &CreateStudyBlock {
                section_id: section.id.clone(),
                block_type: BlockType::Quotation,
                content: Some("“Abide in me.”".into()),
            },
        )?;
        let question = blocks::create(
            conn,
            &CreateStudyBlock {
                section_id: section.id.clone(),
                block_type: BlockType::Question,
                content: Some("What is fruit?".into()),
            },
        )?;
        let order = vec![
            question.id.clone(),
            quote.id.clone(),
            section.blocks[0].id.clone(),
        ];
        let reordered = blocks::reorder(
            conn,
            &Reorder {
                parent_id: section.id.clone(),
                ids: order,
            },
        )?;
        let types: Vec<_> = reordered.iter().map(|b| b.block_type).collect();
        assert_eq!(
            types,
            [
                BlockType::Question,
                BlockType::Quotation,
                BlockType::Paragraph
            ]
        );
        Ok(())
    });
}

// --- templates -------------------------------------------------------------

#[test]
fn six_built_in_templates_exist_and_are_protected() {
    with_db(|conn| {
        let all = templates::list(conn)?;
        let names: Vec<_> = all
            .iter()
            .filter(|t| t.is_builtin)
            .map(|t| t.name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "Passage Study",
                "Word Study",
                "Topical Study",
                "Biblical Theology Study",
                "Systematic Theology Study",
                "Teaching / Sermon Preparation",
            ]
        );
        let passage = &all[0];
        assert!(matches!(
            templates::delete(conn, &passage.id),
            Err(AppError::Conflict(_))
        ));
        let edit = templates::update(
            conn,
            &UpdateTemplate {
                id: passage.id.clone(),
                template: TemplateInput {
                    name: "Mine".into(),
                    description: None,
                    study_type: StudyType::Passage,
                    sections: passage.sections.clone(),
                },
            },
        );
        assert!(matches!(edit, Err(AppError::Conflict(_))));
        Ok(())
    });
}

#[test]
fn user_templates_can_be_created_duplicated_edited_and_deleted() {
    with_db(|conn| {
        let section = |title: &str| TemplateSection {
            key: None,
            title: title.into(),
            guidance: None,
        };
        let mine = templates::create(
            conn,
            &TemplateInput {
                name: "Inductive Study".into(),
                description: Some("Observe, interpret, apply".into()),
                study_type: StudyType::Passage,
                sections: vec![section("Observe"), section("Interpret"), section("Apply")],
            },
        )?;
        assert!(!mine.is_builtin);

        let passage = templates::get_by_key(conn, "passage-study")?;
        let copy = templates::duplicate(conn, &passage.id)?;
        assert_eq!(copy.name, "Passage Study (copy)");
        assert!(!copy.is_builtin);
        assert_eq!(copy.sections.len(), 9);

        let mut sections_now = copy.sections.clone();
        sections_now.retain(|s| s.title != "Audience");
        sections_now.swap(0, 1);
        sections_now.push(section("Prayer"));
        let edited = templates::update(
            conn,
            &UpdateTemplate {
                id: copy.id.clone(),
                template: TemplateInput {
                    name: "My Passage Study".into(),
                    description: None,
                    study_type: StudyType::Teaching,
                    sections: sections_now,
                },
            },
        )?;
        let titles: Vec<_> = edited.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles.first(), Some(&"Context"));
        assert_eq!(titles.last(), Some(&"Prayer"));
        assert!(!titles.contains(&"Audience"));
        assert_eq!(edited.study_type, StudyType::Teaching);
        assert_eq!(
            templates::get_by_key(conn, "passage-study")?.sections.len(),
            9,
            "built-in untouched"
        );

        templates::delete(conn, &mine.id)?;
        assert!(templates::list(conn)?.iter().all(|t| t.id != mine.id));
        assert!(matches!(
            templates::create(
                conn,
                &TemplateInput {
                    name: "Empty".into(),
                    description: None,
                    study_type: StudyType::Custom,
                    sections: vec![]
                }
            ),
            Err(AppError::InvalidInput(_))
        ));
        Ok(())
    });
}

#[test]
fn a_study_copies_its_template_and_does_not_follow_later_changes() {
    with_db(|conn| {
        let p = project(conn, "Series")?;
        let section = |title: &str| TemplateSection {
            key: None,
            title: title.into(),
            guidance: Some(format!("About {title}")),
        };
        let template = templates::create(
            conn,
            &TemplateInput {
                name: "Short".into(),
                description: None,
                study_type: StudyType::Custom,
                sections: vec![section("One"), section("Two")],
            },
        )?;
        let s = studies::create(
            conn,
            &CreateStudy {
                project_id: p,
                title: "From my template".into(),
                study_type: Some(StudyType::Custom),
                template_id: Some(template.id.clone()),
                ..Default::default()
            },
        )?;
        assert_eq!(s.study.template_id.as_deref(), Some(template.id.as_str()));
        assert_eq!(section_titles(conn, &s.study.id)?, ["One", "Two"]);
        assert_eq!(
            sections::list(conn, &s.study.id)?[0].guidance.as_deref(),
            Some("About One")
        );

        templates::update(
            conn,
            &UpdateTemplate {
                id: template.id.clone(),
                template: TemplateInput {
                    name: "Short".into(),
                    description: None,
                    study_type: StudyType::Custom,
                    sections: vec![section("Changed")],
                },
            },
        )?;
        templates::delete(conn, &template.id)?;
        assert_eq!(
            section_titles(conn, &s.study.id)?,
            ["One", "Two"],
            "study unchanged"
        );
        Ok(())
    });
}

// --- duplication -----------------------------------------------------------

#[test]
fn duplicating_copies_structure_by_default_and_content_on_request() {
    with_db(|conn| {
        let p = project(conn, "John")?;
        let original = studies::create(
            conn,
            &CreateStudy {
                project_id: p.clone(),
                title: "John 15".into(),
                primary_passage: Some("JHN.15.1-JHN.15.11".into()),
                ..Default::default()
            },
        )?;
        let id = original.study.id.clone();
        let text = original.sections[0].blocks[0].id.clone();
        blocks::update(
            conn,
            &UpdateStudyBlock {
                id: text,
                content: Some("I am the true vine.".into()),
            },
        )?;
        findings::create(
            conn,
            &CreateFinding {
                study_id: id.clone(),
                finding_type: FindingType::Question,
                content: Some("What is fruit?".into()),
                section_id: Some(original.sections[2].id.clone()),
                passage: Some("JHN.15.2".into()),
            },
        )?;

        let structure = studies::duplicate(
            conn,
            &DuplicateStudy {
                study_id: id.clone(),
                include_content: false,
            },
        )?;
        assert_eq!(structure.study.title, "John 15 (copy)");
        assert_eq!(structure.sections.len(), 9);
        assert!(structure
            .sections
            .iter()
            .all(|s| s.blocks.len() == 1 && s.blocks[0].content.is_empty()));
        assert!(findings::list(conn, &structure.study.id)?.is_empty());
        assert!(study_passages::list(conn, &structure.study.id)?.is_empty());

        let full = studies::duplicate(
            conn,
            &DuplicateStudy {
                study_id: id.clone(),
                include_content: true,
            },
        )?;
        assert_eq!(full.sections[0].blocks[0].content, "I am the true vine.");
        let copied = findings::list(conn, &full.study.id)?;
        assert_eq!(copied.len(), 1);
        assert_eq!(copied[0].passages[0].reference.canonical, "JHN.15.2");
        assert_eq!(
            copied[0].section_id.as_deref(),
            Some(full.sections[2].id.as_str()),
            "mapped to the copied section"
        );
        assert_eq!(
            study_passages::list(conn, &full.study.id)?[0].role,
            PassageRole::Primary
        );
        assert_eq!(findings::list(conn, &id)?.len(), 1, "original untouched");
        Ok(())
    });
}

// --- primary and related passages -----------------------------------------

#[test]
fn a_study_has_at_most_one_primary_passage() {
    with_db(|conn| {
        let p = project(conn, "John")?;
        let s = study(conn, &p, "John 15", StudyType::Passage)?;
        let add = |reference: &str, role: Option<PassageRole>| {
            study_passages::add(
                conn,
                &AddStudyPassage {
                    study_id: s.clone(),
                    reference: reference.into(),
                    role,
                },
            )
        };
        add("JHN.15.1-JHN.15.11", None)?;
        add("JHN.14.15-JHN.14.31", None)?;
        add("1JN.2.24-1JN.2.28", Some(PassageRole::Related))?;
        let roles = |list: Vec<abiding_word_lib::scripture::StudyPassage>| {
            list.into_iter()
                .map(|p| (p.reference.canonical, p.role))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            roles(study_passages::list(conn, &s)?),
            vec![
                ("JHN.15.1-JHN.15.11".to_string(), PassageRole::Primary),
                ("JHN.14.15-JHN.14.31".to_string(), PassageRole::Related),
                ("1JN.2.24-1JN.2.28".to_string(), PassageRole::Related),
            ]
        );

        let related = study_passages::list(conn, &s)?[1].id.clone();
        study_passages::set_role(conn, &related, PassageRole::Primary)?;
        let now = roles(study_passages::list(conn, &s)?);
        assert_eq!(
            now[0],
            ("JHN.14.15-JHN.14.31".to_string(), PassageRole::Primary)
        );
        assert_eq!(
            now.iter()
                .filter(|(_, r)| *r == PassageRole::Primary)
                .count(),
            1
        );
        Ok(())
    });
}

// --- relations -------------------------------------------------------------

#[test]
fn studies_can_be_related_in_both_directions() {
    with_db(|conn| {
        let p = project(conn, "Paul")?;
        let romans = study(conn, &p, "Romans 8", StudyType::Passage)?;
        let galatians = study(conn, &p, "Galatians 4", StudyType::Passage)?;
        let link = relations::create(
            conn,
            &CreateStudyRelation {
                from_study_id: romans.clone(),
                to_study_id: galatians.clone(),
                relation_type: RelationType::Continues,
                note: None,
            },
        )?;
        assert_eq!(
            (link.direction, link.other.title.as_str()),
            ("outgoing", "Galatians 4")
        );
        let from_other = relations::list(conn, &galatians)?;
        assert_eq!(
            (from_other[0].direction, from_other[0].other.title.as_str()),
            ("incoming", "Romans 8")
        );

        let again = relations::create(
            conn,
            &CreateStudyRelation {
                from_study_id: galatians.clone(),
                to_study_id: romans.clone(),
                relation_type: RelationType::Related,
                note: None,
            },
        );
        assert!(
            matches!(again, Err(AppError::Conflict(_))),
            "no duplicate in either direction"
        );
        let itself = relations::create(
            conn,
            &CreateStudyRelation {
                from_study_id: romans.clone(),
                to_study_id: romans.clone(),
                relation_type: RelationType::Related,
                note: None,
            },
        );
        assert!(matches!(itself, Err(AppError::InvalidInput(_))));

        relations::delete(conn, &link.id)?;
        assert!(relations::list(conn, &romans)?.is_empty());
        Ok(())
    });
}

#[test]
fn study_data_survives_a_restart() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let (first, second) = {
        let db = Database::open(&path, &backups).unwrap();
        db.with_conn(|conn| {
            let p = project(conn, "Paul")?;
            let first = study(conn, &p, "Romans 8", StudyType::Passage)?;
            let second = study(conn, &p, "Justification", StudyType::SystematicTheology)?;
            relations::create(
                conn,
                &CreateStudyRelation {
                    from_study_id: first.clone(),
                    to_study_id: second.clone(),
                    relation_type: RelationType::Supports,
                    note: None,
                },
            )?;
            studies::update(
                conn,
                &UpdateStudy {
                    id: second.clone(),
                    status: Some(StudyStatus::Paused),
                    ..Default::default()
                },
            )?;
            let reversed: Vec<String> = sections::list(conn, &first)?
                .into_iter()
                .map(|s| s.id)
                .rev()
                .collect();
            sections::reorder(
                conn,
                &Reorder {
                    parent_id: first.clone(),
                    ids: reversed,
                },
            )?;
            Ok((first, second))
        })
        .unwrap()
    };
    let db = Database::open(&path, &backups).unwrap();
    db.with_conn(|conn| {
        assert_eq!(
            relations::list(conn, &first)?[0].relation_type,
            RelationType::Supports
        );
        assert_eq!(studies::get(conn, &second)?.status, StudyStatus::Paused);
        assert_eq!(
            studies::get(conn, &second)?.study_type,
            StudyType::SystematicTheology
        );
        assert_eq!(
            section_titles(conn, &first)?.first().map(String::as_str),
            Some("Teaching")
        );
        Ok(())
    })
    .unwrap();
}
