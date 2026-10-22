//! The example project (v0.19): "Example: Abiding in Christ — John 15:1–11".
//!
//! Added only when the person asks for it (Settings › Data and backup). Its
//! content is `resources/sample/abiding-in-christ.json`, built into the app,
//! so it needs no internet; the interface's test double reads the same file.
//! It is ordinary work once added: a project with one Bible Study and three
//! Bible Teachings (a message, a group Bible study and an interactive
//! lesson), made through the same functions as the person's own.
//!
//! Adding it again while it is there adds nothing: the project it became is
//! remembered in the settings table. Once the person deletes it, it can be
//! added again.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::{blocks, findings, projects, settings, studies, teaching, workspaces};
use crate::domain::{
    AddTeachingPassage, CreateFinding, CreateProject, CreateStudy, CreateTeaching, FindingType,
    StartingPoint, UpdateStudyBlock, UpdateTeaching, UpdateTeachingPoint,
};
use crate::error::{AppError, AppResult};

const CONTENT: &str = include_str!("../../resources/sample/abiding-in-christ.json");
const INSTALLED: &str = "sample.abiding-in-christ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sample {
    project: SampleProject,
    study: SampleStudy,
    teachings: Vec<SampleTeaching>,
}

#[derive(Debug, Deserialize)]
struct SampleProject {
    title: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SampleStudy {
    title: String,
    template_key: String,
    passage: String,
    description: String,
    parts: std::collections::BTreeMap<String, String>,
    notes: Vec<SampleNote>,
}

#[derive(Debug, Deserialize)]
struct SampleNote {
    section: String,
    #[serde(rename = "type")]
    kind: String,
    text: String,
    #[serde(default)]
    passage: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SampleTeaching {
    title: String,
    kind: String,
    audience: String,
    purpose: String,
    central_message: String,
    introduction: String,
    conclusion: String,
    points: Vec<SamplePoint>,
}

#[derive(Debug, Deserialize)]
struct SamplePoint {
    title: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    passage: Option<String>,
    explanation: String,
    application: String,
    illustration: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SampleReport {
    pub project_id: String,
    pub title: String,
    /// False when it was already there and nothing was added.
    pub added: bool,
}

fn content() -> AppResult<Sample> {
    serde_json::from_str(CONTENT)
        .map_err(|e| AppError::Unexpected(format!("example project content: {e}")))
}

/// Adds the example project, or finds the one already added.
pub fn install(conn: &Connection) -> AppResult<SampleReport> {
    if let Some(id) = settings::read::<String>(conn, INSTALLED)? {
        if let Ok(project) = projects::get(conn, &id) {
            return Ok(SampleReport {
                project_id: project.id,
                title: project.title,
                added: false,
            });
        }
    }
    let sample = content()?;
    let workspace = workspaces::get_default(conn)?;
    let project = projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: sample.project.title.clone(),
            description: Some(sample.project.description.clone()),
        },
    )?;
    // The study and teaching functions keep their own transactions, so the
    // whole is not one: if any step fails, the project is removed again and
    // everything in it goes with it.
    if let Err(error) = fill(conn, &sample, &project.id) {
        conn.execute("DELETE FROM projects WHERE id = ?1", [&project.id])?;
        return Err(error);
    }
    settings::write(conn, INSTALLED, &project.id)?;
    Ok(SampleReport {
        project_id: project.id,
        title: project.title,
        added: true,
    })
}

fn fill(tx: &Connection, sample: &Sample, project_id: &str) -> AppResult<()> {
    let s = &sample.study;
    let detail = studies::create(
        tx,
        &CreateStudy {
            project_id: project_id.to_string(),
            title: s.title.clone(),
            template_key: Some(s.template_key.clone()),
            primary_passage: Some(s.passage.clone()),
            description: Some(s.description.clone()),
            ..Default::default()
        },
    )?;
    let section = |key: &str| {
        detail
            .sections
            .iter()
            .find(|sec| sec.key.as_deref() == Some(key))
            .ok_or_else(|| AppError::Unexpected(format!("example project: no part {key}")))
    };
    for (key, text) in &s.parts {
        let part = section(key)?;
        let block = part
            .blocks
            .first()
            .ok_or_else(|| AppError::Unexpected(format!("example project: part {key} is empty")))?;
        blocks::update(
            tx,
            &UpdateStudyBlock {
                id: block.id.clone(),
                content: Some(text.clone()),
            },
        )?;
    }
    for note in &s.notes {
        findings::create(
            tx,
            &CreateFinding {
                study_id: detail.study.id.clone(),
                finding_type: FindingType::parse(&note.kind)?,
                content: Some(note.text.clone()),
                section_id: Some(section(&note.section)?.id.clone()),
                passage: note.passage.clone(),
            },
        )?;
    }
    for t in &sample.teachings {
        let prep = teaching::create(
            tx,
            &CreateTeaching {
                study_id: detail.study.id.clone(),
                title: t.title.clone(),
                kind: Some(t.kind.clone()),
                points: t
                    .points
                    .iter()
                    .map(|p| StartingPoint {
                        title: p.title.clone(),
                        kind: p.kind.clone(),
                    })
                    .collect(),
            },
        )?;
        teaching::update(
            tx,
            &UpdateTeaching {
                id: prep.id.clone(),
                audience: Some(t.audience.clone()),
                purpose: Some(t.purpose.clone()),
                central_message: Some(t.central_message.clone()),
                introduction: Some(t.introduction.clone()),
                conclusion: Some(t.conclusion.clone()),
                ..Default::default()
            },
        )?;
        for (point, p) in prep.points.iter().zip(&t.points) {
            teaching::update_point(
                tx,
                &UpdateTeachingPoint {
                    id: point.id.clone(),
                    explanation: Some(p.explanation.clone()),
                    application: Some(p.application.clone()),
                    illustration: Some(p.illustration.clone()),
                    ..Default::default()
                },
            )?;
            if let Some(reference) = &p.passage {
                teaching::add_passage(
                    tx,
                    &AddTeachingPassage {
                        preparation_id: prep.id.clone(),
                        point_id: Some(point.id.clone()),
                        reference: reference.clone(),
                    },
                )?;
            }
        }
    }
    Ok(())
}
