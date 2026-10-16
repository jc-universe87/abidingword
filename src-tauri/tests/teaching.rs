//! Teaching Preparation (v0.16): the person's own teaching, written from a
//! study. Several per study; ordered points; study findings linked (never
//! copied, never owned); Scripture named without touching the study's
//! passages; what is kept from the assistant stored apart with an honest
//! standing. All text is invented.

use abiding_word_lib::db::{
    findings, migrations, projects, studies, study_passages, teaching, workspaces, Database,
};
use abiding_word_lib::domain::{
    AddTeachingPassage, CreateFinding, CreateProject, CreateStudy, CreateTeaching,
    CreateTeachingPoint, ExternalSource, FindingType, ImageInfo, KeepTeachingMaterial,
    LinkTeachingFinding, Reorder, UpdateFinding, UpdateTeaching, UpdateTeachingPoint,
};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::scripture::AddStudyPassage;
use rusqlite::Connection;

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn new_study(conn: &Connection, title: &str) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let project = match projects::list(conn, &workspace.id)?.into_iter().next() {
        Some(p) => p.id,
        None => {
            projects::create(
                conn,
                &CreateProject {
                    workspace_id: workspace.id,
                    title: "Collection".into(),
                    description: None,
                },
            )?
            .id
        }
    };
    Ok(studies::create(
        conn,
        &CreateStudy {
            project_id: project,
            title: title.into(),
            ..Default::default()
        },
    )?
    .study
    .id)
}

fn finding(conn: &Connection, study: &str, text: &str) -> AppResult<String> {
    Ok(findings::create(
        conn,
        &CreateFinding {
            study_id: study.into(),
            finding_type: FindingType::Observation,
            content: Some(text.into()),
            section_id: None,
            passage: None,
        },
    )?
    .id)
}

fn prep(conn: &Connection, study: &str, title: &str) -> AppResult<String> {
    Ok(teaching::create(
        conn,
        &CreateTeaching {
            study_id: study.into(),
            title: title.into(),
            kind: Some("sermon".into()),
        },
    )?
    .id)
}

fn code<T: std::fmt::Debug>(result: AppResult<T>) -> String {
    match result {
        Err(AppError::InvalidInput(m)) | Err(AppError::InvalidReference(m)) => {
            m.code.unwrap_or_default().to_string()
        }
        Err(AppError::NotFound { entity, .. }) => format!("notFound:{entity}"),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_study_has_several_preparations_each_saved_and_deleted_on_its_own() {
    with_db(|conn| {
        let study = new_study(conn, "John 15")?;
        let sermon = prep(conn, &study, "Sunday sermon")?;
        let group = teaching::create(
            conn,
            &CreateTeaching {
                study_id: study.clone(),
                title: "  Small group  ".into(),
                kind: None,
            },
        )?;
        assert_eq!(group.title, "Small group");
        let list = teaching::list(conn, &study)?;
        assert_eq!(
            list.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(),
            ["Sunday sermon", "Small group"]
        );

        let updated = teaching::update(
            conn,
            &UpdateTeaching {
                id: sermon.clone(),
                audience: Some("Whole church, many families".into()),
                purpose: Some("  To help us remain in Christ  ".into()),
                central_message: Some("Fruit comes from abiding, not striving.".into()),
                introduction: Some("Last week a vine…\n\nToday:".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(
            updated.purpose.as_deref(),
            Some("To help us remain in Christ")
        );
        assert_eq!(
            updated.introduction, "Last week a vine…\n\nToday:",
            "kept exactly as typed"
        );
        // Clearing an optional field; leaving others as they were.
        let cleared = teaching::update(
            conn,
            &UpdateTeaching {
                id: sermon.clone(),
                audience: Some("".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(cleared.audience, None);
        assert_eq!(
            cleared.central_message.as_deref(),
            Some("Fruit comes from abiding, not striving.")
        );
        assert!(cleared.revision > updated.revision - 1);

        assert_eq!(
            code(teaching::update(
                conn,
                &UpdateTeaching {
                    id: sermon.clone(),
                    kind: Some("podcast".into()),
                    ..Default::default()
                },
            )),
            "invalidChoice"
        );
        assert_eq!(
            code(teaching::create(
                conn,
                &CreateTeaching {
                    study_id: study.clone(),
                    title: "   ".into(),
                    kind: None,
                },
            )),
            "validation.titleRequired"
        );

        teaching::delete(conn, &group.id)?;
        assert_eq!(teaching::list(conn, &study)?.len(), 1);
        assert_eq!(
            code(teaching::get(conn, &group.id)),
            "notFound:teaching preparation"
        );
        // The study is untouched.
        assert_eq!(studies::get(conn, &study)?.title, "John 15");
        Ok(())
    });
}

#[test]
fn points_keep_their_order_through_inserting_moving_and_removing() {
    with_db(|conn| {
        let study = new_study(conn, "John 15")?;
        let id = prep(conn, &study, "Sermon")?;
        let add = |title: &str, after: Option<String>| {
            teaching::create_point(
                conn,
                &CreateTeachingPoint {
                    preparation_id: id.clone(),
                    title: Some(title.into()),
                    after_point_id: after,
                },
            )
        };
        add("The vine", None)?;
        add("The branches", None)?;
        let p = add("The fruit", None)?;
        let titles = |p: &abiding_word_lib::domain::TeachingPreparation| {
            p.points.iter().map(|x| x.title.clone()).collect::<Vec<_>>()
        };
        assert_eq!(titles(&p), ["The vine", "The branches", "The fruit"]);
        // Inserted straight after the first point.
        let first = p.points[0].id.clone();
        let p = add("The vinedresser", Some(first.clone()))?;
        assert_eq!(
            titles(&p),
            ["The vine", "The vinedresser", "The branches", "The fruit"]
        );
        assert_eq!(
            p.points.iter().map(|x| x.position).collect::<Vec<_>>(),
            [0, 1, 2, 3]
        );
        // Reordered.
        let mut ids: Vec<String> = p.points.iter().map(|x| x.id.clone()).collect();
        ids.reverse();
        let p = teaching::reorder_points(
            conn,
            &Reorder {
                parent_id: id.clone(),
                ids: ids.clone(),
            },
        )?;
        assert_eq!(
            titles(&p),
            ["The fruit", "The branches", "The vinedresser", "The vine"]
        );
        // A stale order is refused rather than guessed.
        assert_eq!(
            code(teaching::reorder_points(
                conn,
                &Reorder {
                    parent_id: id.clone(),
                    ids: ids[..3].to_vec(),
                },
            )),
            "changedMeanwhile"
        );
        // Edited and removed.
        let p = teaching::update_point(
            conn,
            &UpdateTeachingPoint {
                id: first.clone(),
                explanation: Some("Jesus is the true vine.".into()),
                application: Some("Stay close.".into()),
                ..Default::default()
            },
        )?;
        let vine = p.points.iter().find(|x| x.id == first).unwrap();
        assert_eq!(
            (vine.title.as_str(), vine.explanation.as_str()),
            ("The vine", "Jesus is the true vine.")
        );
        let p = teaching::delete_point(conn, &p.points[1].id)?;
        assert_eq!(titles(&p), ["The fruit", "The vinedresser", "The vine"]);
        assert_eq!(
            p.points.iter().map(|x| x.position).collect::<Vec<_>>(),
            [0, 1, 2]
        );
        Ok(())
    });
}

#[test]
fn findings_are_linked_live_never_copied_and_never_owned() {
    with_db(|conn| {
        let study = new_study(conn, "John 15")?;
        let other = new_study(conn, "Romans 8")?;
        let id = prep(conn, &study, "Sermon")?;
        let point = teaching::create_point(
            conn,
            &CreateTeachingPoint {
                preparation_id: id.clone(),
                title: Some("Abide".into()),
                after_point_id: None,
            },
        )?
        .points[0]
            .id
            .clone();
        let f = finding(conn, &study, "Abiding is a relationship, not a technique.")?;
        let foreign = finding(conn, &other, "No condemnation.")?;
        let link = |point_id: Option<String>, finding_id: &str| {
            teaching::link_finding(
                conn,
                &LinkTeachingFinding {
                    preparation_id: id.clone(),
                    point_id,
                    finding_id: finding_id.into(),
                },
            )
        };
        let p = link(Some(point.clone()), &f)?;
        assert_eq!(p.findings.len(), 1);
        // Linking again to the same place changes nothing; elsewhere is another link.
        assert_eq!(link(Some(point.clone()), &f)?.findings.len(), 1);
        assert_eq!(link(None, &f)?.findings.len(), 2);
        assert_eq!(code(link(None, &foreign)), "teaching.otherStudyFinding");
        let before: i64 = conn.query_row("SELECT COUNT(*) FROM findings", [], |r| r.get(0))?;

        // Live: an edit in the study shows here.
        findings::update(
            conn,
            &UpdateFinding {
                id: f.clone(),
                content: Some("Abiding is a relationship.".into()),
                ..Default::default()
            },
        )?;
        let p = teaching::get(conn, &id)?;
        assert!(p
            .findings
            .iter()
            .all(|l| l.finding.content == "Abiding is a relationship."));

        // Unlinking leaves the finding in the study.
        let p = teaching::unlink_finding(conn, &p.findings[0].id)?;
        assert_eq!(p.findings.len(), 1);
        assert_eq!(
            findings::get(conn, &f)?.content,
            "Abiding is a relationship."
        );
        // Deleting the teaching leaves the finding too.
        teaching::delete(conn, &id)?;
        assert_eq!(findings::list(conn, &study)?.len(), 1);
        let after: i64 = conn.query_row("SELECT COUNT(*) FROM findings", [], |r| r.get(0))?;
        assert_eq!(before, after, "no finding was ever copied");

        // A finding deleted in the study no longer shows in a teaching.
        let id2 = prep(conn, &study, "Group study")?;
        teaching::link_finding(
            conn,
            &LinkTeachingFinding {
                preparation_id: id2.clone(),
                point_id: None,
                finding_id: f.clone(),
            },
        )?;
        findings::delete(conn, &f)?;
        assert!(teaching::get(conn, &id2)?.findings.is_empty());
        Ok(())
    });
}

#[test]
fn scripture_is_named_in_the_teaching_without_touching_the_study() {
    with_db(|conn| {
        let study = new_study(conn, "John 15")?;
        study_passages::add(
            conn,
            &AddStudyPassage {
                study_id: study.clone(),
                reference: "JHN.15.1-JHN.15.8".into(),
                role: None,
            },
        )?;
        let id = prep(conn, &study, "Sermon")?;
        let add = |reference: &str, point_id: Option<String>| {
            teaching::add_passage(
                conn,
                &AddTeachingPassage {
                    preparation_id: id.clone(),
                    point_id,
                    reference: reference.into(),
                },
            )
        };
        let p = add("GAL.5.22-GAL.5.23", None)?;
        assert_eq!(p.passages.len(), 1);
        assert_eq!(p.passages[0].reference.display, "Galatians 5:22–23");
        assert_eq!(
            add("GAL.5.22-GAL.5.23", None)?.passages.len(),
            1,
            "kept once"
        );
        assert!(add("XYZ.1.1", None).is_err());
        assert_eq!(
            study_passages::list(conn, &study)?.len(),
            1,
            "the study's passages are unchanged"
        );

        let point = teaching::create_point(
            conn,
            &CreateTeachingPoint {
                preparation_id: id.clone(),
                ..Default::default()
            },
        )?
        .points[0]
            .id
            .clone();
        let p = add("PSA.1.3", Some(point.clone()))?;
        assert_eq!(p.passages.len(), 2);
        // Removing the point removes what was attached to it.
        let p = teaching::delete_point(conn, &point)?;
        assert_eq!(p.passages.len(), 1);
        let p = teaching::remove_passage(conn, &p.passages[0].id)?;
        assert!(p.passages.is_empty());
        Ok(())
    });
}

fn source(url: &str) -> ExternalSource {
    ExternalSource {
        title: "A report".into(),
        url: url.into(),
        site: String::new(),
        excerpt: "What it says.".into(),
    }
}

#[test]
fn kept_material_carries_an_honest_standing() {
    with_db(|conn| {
        let study = new_study(conn, "John 15")?;
        let id = prep(conn, &study, "Sermon")?;
        let keep =
            |kind: &str, standing: &str, sources: Vec<ExternalSource>, image: Option<ImageInfo>| {
                teaching::keep_material(
                    conn,
                    &KeepTeachingMaterial {
                        preparation_id: id.clone(),
                        point_id: None,
                        kind: kind.into(),
                        standing: standing.into(),
                        title: "Item".into(),
                        content: "What happened, as the sources say.".into(),
                        sources,
                        image,
                        assistant: Some("Example · model".into()),
                    },
                )
            };
        // A checked story needs two different sites.
        assert_eq!(
            code(keep(
                "story",
                "verified",
                vec![
                    source("https://www.bbc.co.uk/a"),
                    source("https://news.bbc.co.uk/b")
                ],
                None
            )),
            "teaching.notVerified"
        );
        let p = keep(
            "story",
            "verified",
            vec![
                source("https://www.bbc.co.uk/a"),
                source("https://www.theguardian.com/b"),
            ],
            None,
        )?;
        assert_eq!(p.materials[0].standing, "verified");
        assert_eq!(p.materials[0].sources.len(), 2);
        assert_eq!(p.materials[0].assistant.as_deref(), Some("Example · model"));
        // Invented illustrations are only kept as invented.
        assert_eq!(
            code(keep("illustration", "verified", vec![], None)),
            "teaching.badMaterial"
        );
        keep("illustration", "hypothetical", vec![], None)?;
        // Links must be web addresses.
        assert_eq!(
            code(keep(
                "story",
                "unverified",
                vec![source("javascript:alert(1)")],
                None
            )),
            "teaching.badMaterial"
        );
        // Images: found with an address, or generated with a file the app named.
        let found = ImageInfo {
            url: Some("https://upload.wikimedia.org/v.jpg".into()),
            page_url: Some("https://commons.wikimedia.org/wiki/File:V.jpg".into()),
            licence: Some("CC BY-SA 4.0".into()),
            attribution: Some("Jane Doe, CC BY-SA 4.0, via Wikimedia Commons".into()),
            ..Default::default()
        };
        keep("image", "found", vec![], Some(found.clone()))?;
        assert_eq!(
            code(keep("image", "generated", vec![], Some(found))),
            "teaching.badMaterial"
        );
        let traversal = ImageInfo {
            file: Some("../../etc/passwd.png".into()),
            ..Default::default()
        };
        assert_eq!(
            code(keep("image", "generated", vec![], Some(traversal))),
            "teaching.badMaterial"
        );
        let generated = ImageInfo {
            file: Some("0f8c2a2e-1111-4a4a-9c9c-123456789abc.png".into()),
            ..Default::default()
        };
        let p = keep("image", "generated", vec![], Some(generated))?;
        assert_eq!(p.materials.len(), 4);
        let p = teaching::remove_material(conn, &p.materials[0].id)?;
        assert_eq!(p.materials.len(), 3);
        Ok(())
    });
}

#[test]
fn the_schema_is_at_version_eight() {
    with_db(|conn| {
        assert_eq!(migrations::current_version(conn)?, 8);
        Ok(())
    });
}
