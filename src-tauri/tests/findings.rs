//! Findings: types, persistence, passages, tags, ordering; and study search.

use std::path::Path;

use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::{
    blocks, findings, projects, sections, studies, study_search, workspaces, Database,
};
use abiding_word_lib::domain::{
    CreateFinding, CreateProject, CreateStudy, FindingType, LinkFindingPassage, Reorder,
    SetFindingTags, UpdateFinding, UpdateStudy, UpdateStudyBlock, UpdateStudySection,
};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::CommitImport;
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
                    title: "John".into(),
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

fn add(conn: &Connection, study: &str, kind: FindingType, text: &str) -> AppResult<String> {
    Ok(findings::create(
        conn,
        &CreateFinding {
            study_id: study.into(),
            finding_type: kind,
            content: Some(text.into()),
            section_id: None,
            passage: None,
        },
    )?
    .id)
}

#[test]
fn every_finding_type_can_be_created_updated_and_deleted() {
    with_db(|conn| {
        let s = new_study(conn, "John 15")?;
        for kind in FindingType::ALL {
            add(conn, &s, *kind, kind.as_str())?;
        }
        let all = findings::list(conn, &s)?;
        assert_eq!(all.len(), 10);
        assert_eq!(
            all.iter().map(|f| f.finding_type).collect::<Vec<_>>(),
            FindingType::ALL.to_vec()
        );
        assert_eq!(
            all.iter().map(|f| f.sort_order).collect::<Vec<_>>(),
            (0..10).collect::<Vec<i64>>()
        );

        let q = all
            .iter()
            .find(|f| f.finding_type == FindingType::Question)
            .unwrap();
        let changed = findings::update(
            conn,
            &UpdateFinding {
                id: q.id.clone(),
                finding_type: Some(FindingType::UnresolvedIssue),
                content: Some("Still unclear".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(
            (
                changed.finding_type,
                changed.content.as_str(),
                changed.revision
            ),
            (FindingType::UnresolvedIssue, "Still unclear", 2)
        );

        findings::delete(conn, &q.id)?;
        assert_eq!(findings::list(conn, &s)?.len(), 9);
        assert!(matches!(
            findings::get(conn, &q.id),
            Err(AppError::NotFound { .. })
        ));
        assert!(matches!(
            FindingType::parse("hunch"),
            Err(AppError::InvalidInput(_))
        ));
        Ok(())
    });
}

#[test]
fn findings_can_belong_to_a_section_or_the_whole_study() {
    with_db(|conn| {
        let s = new_study(conn, "John 15")?;
        let observations = sections::list(conn, &s)?[2].clone();
        let in_section = findings::create(
            conn,
            &CreateFinding {
                study_id: s.clone(),
                finding_type: FindingType::Observation,
                content: Some("Abide x10".into()),
                section_id: Some(observations.id.clone()),
                passage: None,
            },
        )?;
        assert_eq!(
            in_section.section_id.as_deref(),
            Some(observations.id.as_str())
        );
        let study_level = add(conn, &s, FindingType::Conclusion, "Dependence, not effort.")?;
        assert_eq!(findings::get(conn, &study_level)?.section_id, None);

        let moved = findings::update(
            conn,
            &UpdateFinding {
                id: in_section.id.clone(),
                section_id: Some(String::new()),
                ..Default::default()
            },
        )?;
        assert_eq!(moved.section_id, None);

        let other = new_study(conn, "Romans 8")?;
        let foreign = sections::list(conn, &other)?[0].id.clone();
        assert!(matches!(
            findings::update(
                conn,
                &UpdateFinding {
                    id: study_level,
                    section_id: Some(foreign),
                    ..Default::default()
                }
            ),
            Err(AppError::InvalidInput(_))
        ));
        Ok(())
    });
}

#[test]
fn findings_link_to_canonical_passages() {
    with_db(|conn| {
        let s = new_study(conn, "John 15")?;
        let f = findings::create(
            conn,
            &CreateFinding {
                study_id: s.clone(),
                finding_type: FindingType::Observation,
                content: Some("The command to abide appears repeatedly.".into()),
                section_id: None,
                passage: Some("JHN.15.4-JHN.15.7".into()),
            },
        )?;
        assert_eq!(f.passages[0].reference.display, "John 15:4–7");
        let linked = findings::link_passage(
            conn,
            &LinkFindingPassage {
                finding_id: f.id.clone(),
                reference: "JHN.15.2".into(),
            },
        )?;
        let again = findings::link_passage(
            conn,
            &LinkFindingPassage {
                finding_id: f.id.clone(),
                reference: "JHN.15.2".into(),
            },
        )?;
        assert_eq!(linked.passages.len(), 2);
        assert_eq!(again.passages.len(), 2, "no duplicate link");
        let unlinked = findings::unlink_passage(conn, &linked.passages[0].id)?;
        assert_eq!(
            unlinked
                .passages
                .iter()
                .map(|p| p.reference.canonical.as_str())
                .collect::<Vec<_>>(),
            ["JHN.15.2"]
        );
        assert!(matches!(
            findings::link_passage(
                conn,
                &LinkFindingPassage {
                    finding_id: f.id,
                    reference: "JHN.30.1".into()
                }
            ),
            Err(AppError::InvalidReference(_))
        ));
        Ok(())
    });
}

#[test]
fn finding_passages_survive_bible_removal_and_restart() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/usfm-a");
    let files: Vec<_> = std::fs::read_dir(fixture)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    let finding = {
        let db = Database::open(&path, &backups).unwrap();
        db.with_conn(|conn| {
            let staged = import::stage(&files, ImportOrigin::UserFiles)?;
            let bible = bibles::commit_import(
                conn,
                "fx",
                &staged.content,
                &CommitImport {
                    preview_id: staged.id.clone(),
                    name: "Fixture".into(),
                    short_name: "FX".into(),
                    language: "English".into(),
                    language_code: None,
                    publisher: None,
                    copyright_notice: None,
                    license_type: None,
                    words: Default::default(),
                    as_document: false,
                },
                &SourceRecord {
                    origin: "managed_copy",
                    path: None,
                    original_file_name: None,
                    format: "usfm",
                    is_builtin: false,
                },
            )?;
            let s = new_study(conn, "John 15")?;
            let f = findings::create(
                conn,
                &CreateFinding {
                    study_id: s,
                    finding_type: FindingType::Question,
                    content: Some("What is fruit?".into()),
                    section_id: None,
                    passage: Some("JHN.15.2".into()),
                },
            )?;
            bibles::remove(conn, &bible.id)?;
            Ok(f.id)
        })
        .unwrap()
    };
    let db = Database::open(&path, &backups).unwrap();
    db.with_conn(|conn| {
        let f = findings::get(conn, &finding)?;
        assert_eq!(f.content, "What is fruit?");
        assert_eq!(f.passages[0].reference.canonical, "JHN.15.2");
        assert!(bibles::list(conn)?.is_empty());
        Ok(())
    })
    .unwrap();
}

#[test]
fn findings_can_be_reordered_and_tagged() {
    with_db(|conn| {
        let s = new_study(conn, "Romans 8")?;
        let a = add(conn, &s, FindingType::Observation, "a")?;
        let b = add(conn, &s, FindingType::Question, "b")?;
        let c = add(conn, &s, FindingType::Conclusion, "c")?;
        let reordered = findings::reorder(
            conn,
            &Reorder {
                parent_id: s.clone(),
                ids: vec![c.clone(), a.clone(), b.clone()],
            },
        )?;
        assert_eq!(
            reordered
                .iter()
                .map(|f| f.content.as_str())
                .collect::<Vec<_>>(),
            ["c", "a", "b"]
        );

        let tagged = findings::set_tags(
            conn,
            &SetFindingTags {
                finding_id: a.clone(),
                tags: vec![
                    "#Justification".into(),
                    " covenant  law ".into(),
                    "justification".into(),
                    "".into(),
                ],
            },
        )?;
        assert_eq!(tagged.tags, ["covenant law", "justification"]);
        let cleared = findings::set_tags(
            conn,
            &SetFindingTags {
                finding_id: a,
                tags: vec![],
            },
        )?;
        assert!(cleared.tags.is_empty());
        Ok(())
    });
}

#[test]
fn findings_survive_a_restart() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let (study, finding) = {
        let db = Database::open(&path, &backups).unwrap();
        db.with_conn(|conn| {
            let s = new_study(conn, "John 15")?;
            let f = add(
                conn,
                &s,
                FindingType::Application,
                "Stay close to Christ this week.",
            )?;
            findings::set_tags(
                conn,
                &SetFindingTags {
                    finding_id: f.clone(),
                    tags: vec!["sermon".into()],
                },
            )?;
            Ok((s, f))
        })
        .unwrap()
    };
    let db = Database::open(&path, &backups).unwrap();
    db.with_conn(|conn| {
        let all = findings::list(conn, &study)?;
        assert_eq!(all.len(), 1);
        assert_eq!(
            (all[0].id.as_str(), all[0].finding_type, all[0].tags.clone()),
            (
                finding.as_str(),
                FindingType::Application,
                vec!["sermon".to_string()]
            )
        );
        Ok(())
    })
    .unwrap();
}

// --- study search ----------------------------------------------------------

/// The full-text index holds exactly one row per mapped item: nothing
/// orphaned by deletes or edits.
fn assert_index_consistent(conn: &Connection) -> AppResult<()> {
    let orphans: i64 = conn.query_row(
        "SELECT COUNT(*) FROM study_search WHERE rowid NOT IN (SELECT id FROM study_search_items)",
        [],
        |r| r.get(0),
    )?;
    let missing: i64 = conn.query_row(
        "SELECT COUNT(*) FROM study_search_items WHERE id NOT IN (SELECT rowid FROM study_search)",
        [],
        |r| r.get(0),
    )?;
    assert_eq!(
        (orphans, missing),
        (0, 0),
        "index out of step with its items"
    );
    Ok(())
}

#[test]
fn study_search_covers_titles_sections_blocks_and_findings() {
    with_db(|conn| {
        let vine = new_study(conn, "The True Vine")?;
        let other = new_study(conn, "Romans 8")?;
        let vine_sections = sections::list(conn, &vine)?;
        blocks::update(
            conn,
            &UpdateStudyBlock {
                id: vine_sections[2].blocks[0].id.clone(),
                content: Some("Spoken on the way to Gethsemane.".into()),
            },
        )?;
        sections::update(
            conn,
            &UpdateStudySection {
                id: vine_sections[5].id.clone(),
                title: Some("Sermon Outline".into()),
                ..Default::default()
            },
        )?;
        add(
            conn,
            &vine,
            FindingType::Question,
            "What exactly does fruit refer to here?",
        )?;
        studies::update(
            conn,
            &UpdateStudy {
                id: other.clone(),
                description: Some("Adoption and the Spirit".into()),
                ..Default::default()
            },
        )?;

        let hit = |q: &str| -> AppResult<Vec<(String, String, String)>> {
            Ok(study_search::search(conn, q)?
                .into_iter()
                .map(|h| (h.study_title, h.kind, h.location))
                .collect())
        };
        assert_eq!(
            hit("vine")?,
            [(
                "The True Vine".to_string(),
                "study".to_string(),
                "Title or purpose".to_string()
            )]
        );
        assert_eq!(
            hit("gethsemane")?,
            [(
                "The True Vine".to_string(),
                "block".to_string(),
                "Context".to_string()
            )]
        );
        assert_eq!(
            hit("outline")?,
            [(
                "The True Vine".to_string(),
                "section".to_string(),
                "Section title".to_string()
            )]
        );
        assert_eq!(
            hit("fruit")?,
            [(
                "The True Vine".to_string(),
                "finding".to_string(),
                "Finding: Question".to_string()
            )]
        );
        assert_eq!(
            hit("adoption")?,
            [(
                "Romans 8".to_string(),
                "study".to_string(),
                "Title or purpose".to_string()
            )]
        );
        assert!(hit("condemnation")?.is_empty());

        let snippet = &study_search::search(conn, "gethsemane")?[0].snippet;
        assert!(snippet.contains("\u{2}Gethsemane\u{3}"), "{snippet:?}");

        // Deleting and editing keep the index in step.
        let finding = findings::list(conn, &vine)?[0].id.clone();
        findings::delete(conn, &finding)?;
        assert!(hit("fruit")?.is_empty());
        blocks::update(
            conn,
            &UpdateStudyBlock {
                id: vine_sections[2].blocks[0].id.clone(),
                content: Some("Now about the garden.".into()),
            },
        )?;
        assert!(hit("gethsemane")?.is_empty());
        assert_eq!(hit("garden")?.len(), 1);
        assert_index_consistent(conn)?;
        Ok(())
    });
}
