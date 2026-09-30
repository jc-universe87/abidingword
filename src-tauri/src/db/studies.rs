use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{blocks, findings, new_id, now, projects, sections, study_passages, templates};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::domain::{
    BlockType, CreateStudy, DuplicateStudy, ListStudies, Study, StudyDetail, StudyDetails,
    StudyStatus, StudySummary, StudyTemplate, StudyType, TemplateSection, UpdateStudy,
};
use crate::error::{AppError, AppResult};
use crate::scripture::reference::ScriptureRef;
use crate::scripture::AddStudyPassage;

const COLUMNS: &str = "id, project_id, template_id, title, study_type, status, description, \
                       details, created_at, updated_at, revision";

fn from_row(row: &Row) -> rusqlite::Result<Study> {
    let conversion = |index: usize, e: AppError| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, e.into())
    };
    let study_type: String = row.get(4)?;
    let status: String = row.get(5)?;
    let details: Option<String> = row.get(7)?;
    Ok(Study {
        id: row.get(0)?,
        project_id: row.get(1)?,
        template_id: row.get(2)?,
        title: row.get(3)?,
        study_type: StudyType::parse(&study_type).map_err(|e| conversion(4, e))?,
        status: StudyStatus::parse(&status).map_err(|e| conversion(5, e))?,
        description: row.get(6)?,
        // Unreadable details fall back to empty rather than hiding the study.
        details: details
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default(),
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        revision: row.get(10)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Study> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM studies WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("study", id))
}

pub fn get_detail(conn: &Connection, id: &str) -> AppResult<StudyDetail> {
    Ok(StudyDetail {
        study: get(conn, id)?,
        sections: sections::list(conn, id)?,
    })
}

/// Study rows for lists: summary data only (no sections or blocks), most
/// recently changed first.
pub fn list(conn: &Connection, filter: &ListStudies) -> AppResult<Vec<StudySummary>> {
    if let Some(project) = &filter.project_id {
        projects::get(conn, project)?;
    }
    let mut stmt = conn.prepare(
        "SELECT s.id, s.project_id, p.title, s.title, s.study_type, s.status, s.updated_at,
                (SELECT COUNT(*) FROM findings f WHERE f.study_id = s.id AND f.deleted_at IS NULL)
         FROM studies s JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
         WHERE s.deleted_at IS NULL
           AND (?1 IS NULL OR s.project_id = ?1)
           AND (?2 IS NULL OR s.study_type = ?2)
           AND (?3 IS NULL OR s.status = ?3)
         ORDER BY s.updated_at DESC, s.title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(
        params![
            filter.project_id,
            filter.study_type.map(StudyType::as_str),
            filter.status.map(StudyStatus::as_str)
        ],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        },
    )?;
    let mut summaries = Vec::new();
    for row in rows {
        let (id, project_id, project_title, title, study_type, status, updated_at, finding_count) =
            row?;
        summaries.push(StudySummary {
            primary_passage: study_passages::primary(conn, &id)?.map(|p| p.reference),
            id,
            project_id,
            project_title,
            title,
            study_type: StudyType::parse(&study_type)?,
            status: StudyStatus::parse(&status)?,
            finding_count,
            updated_at,
        });
    }
    Ok(summaries)
}

fn resolve_template(
    conn: &Connection,
    input: &CreateStudy,
    study_type: StudyType,
) -> AppResult<Option<StudyTemplate>> {
    if let Some(id) = input.template_id.as_deref().filter(|s| !s.is_empty()) {
        return templates::get(conn, id).map(Some);
    }
    if let Some(key) = input.template_key.as_deref().filter(|s| !s.is_empty()) {
        return templates::get_by_key(conn, key).map(Some);
    }
    match templates::builtin_key_for(study_type) {
        Some(key) => templates::get_by_key(conn, key).map(Some),
        None => Ok(None),
    }
}

/// Creates a study with its template's sections (copied, not linked), each
/// holding one empty paragraph so the user can start writing straight away.
/// A custom study without a template starts with a single "Notes" section.
pub fn create(conn: &Connection, input: &CreateStudy) -> AppResult<StudyDetail> {
    let title = validate::title(&input.title, "study")?;
    let description = validate::optional_text(
        input.description.as_deref(),
        DESCRIPTION_MAX_CHARS,
        "purpose",
    )?;
    projects::get(conn, &input.project_id)?;
    let study_type = input.study_type.unwrap_or(StudyType::Passage);
    let template = resolve_template(conn, input, study_type)?;
    let primary = match input
        .primary_passage
        .as_deref()
        .filter(|p| !p.trim().is_empty())
    {
        Some(passage) => Some(ScriptureRef::from_canonical(passage)?),
        None => None,
    };
    let section_list: Vec<TemplateSection> = match &template {
        Some(t) => t.sections.clone(),
        None => vec![TemplateSection {
            key: None,
            title: "Notes".into(),
            guidance: None,
        }],
    };

    let id = new_id();
    let now = now();
    // The connection is behind a mutex, so no other transaction can be open.
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO studies (id, project_id, template_id, title, study_type, status, description,
                              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?7)",
        params![
            id,
            input.project_id,
            template.as_ref().map(|t| t.id.clone()),
            title,
            study_type.as_str(),
            description,
            now
        ],
    )?;
    for (index, section) in section_list.iter().enumerate() {
        let section_id = sections::insert(
            &tx,
            &id,
            section.key.as_deref(),
            &section.title,
            section.guidance.as_deref(),
            index as i64,
            &now,
        )?;
        blocks::insert(&tx, &section_id, BlockType::Paragraph, 0, "", &now)?;
    }
    if let Some(reference) = primary {
        study_passages::add(
            &tx,
            &AddStudyPassage {
                study_id: id.clone(),
                reference: reference.canonical(),
                role: Some(crate::domain::PassageRole::Primary),
            },
        )?;
    }
    tx.commit()?;
    get_detail(conn, &id)
}

pub fn update(conn: &Connection, input: &UpdateStudy) -> AppResult<Study> {
    let current = get(conn, &input.id)?;
    let title = match &input.title {
        Some(title) => validate::title(title, "study")?,
        None => current.title,
    };
    let description = match &input.description {
        Some(text) => validate::optional_text(Some(text), DESCRIPTION_MAX_CHARS, "purpose")?,
        None => current.description,
    };
    let details: StudyDetails = input.details.clone().unwrap_or(current.details);
    let details_json = if details == StudyDetails::default() {
        None
    } else {
        Some(serde_json::to_string(&details).map_err(|e| AppError::Unexpected(e.to_string()))?)
    };
    conn.execute(
        "UPDATE studies SET title = ?2, study_type = ?3, status = ?4, description = ?5,
             details = ?6, updated_at = ?7, revision = revision + 1
         WHERE id = ?1",
        params![
            input.id,
            title,
            input.study_type.unwrap_or(current.study_type).as_str(),
            input.status.unwrap_or(current.status).as_str(),
            description,
            details_json,
            now()
        ],
    )?;
    get(conn, &input.id)
}

/// Copies a study into the same project as "<title> (copy)".
///
/// Always: type, purpose, details and sections (with guidance and order);
/// each section gets one empty paragraph. With `include_content`: also the
/// blocks, findings (with their passages and tags) and study passages.
/// Never copied: relations to other studies, and Scripture annotations
/// (they belong to Scripture, not to a study).
pub fn duplicate(conn: &Connection, input: &DuplicateStudy) -> AppResult<StudyDetail> {
    let original = get_detail(conn, &input.study_id)?;
    let study = &original.study;
    let mut title = format!("{} (copy)", study.title);
    if title.chars().count() > validate::TITLE_MAX_CHARS {
        title = study.title.clone();
    }
    let id = new_id();
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO studies (id, project_id, template_id, title, study_type, status, description,
                              details, created_at, updated_at)
         SELECT ?2, project_id, template_id, ?3, study_type, 'active', description, details, ?4, ?4
         FROM studies WHERE id = ?1",
        params![study.id, id, title, now],
    )?;
    let mut section_map = Vec::new();
    for section in &original.sections {
        let new_section = sections::insert(
            &tx,
            &id,
            section.key.as_deref(),
            &section.title,
            section.guidance.as_deref(),
            section.position,
            &now,
        )?;
        if input.include_content && !section.blocks.is_empty() {
            for block in &section.blocks {
                blocks::insert(
                    &tx,
                    &new_section,
                    block.block_type,
                    block.position,
                    &block.content,
                    &now,
                )?;
            }
        } else {
            blocks::insert(&tx, &new_section, BlockType::Paragraph, 0, "", &now)?;
        }
        section_map.push((section.id.clone(), new_section));
    }
    if input.include_content {
        for passage in study_passages::list(&tx, &study.id)? {
            study_passages::add(
                &tx,
                &AddStudyPassage {
                    study_id: id.clone(),
                    reference: passage.reference.canonical,
                    role: Some(passage.role),
                },
            )?;
        }
        findings::copy_all(&tx, &study.id, &id, &section_map)?;
    }
    tx.commit()?;
    get_detail(conn, &id)
}

/// Marks a study as changed when its sections, blocks or findings change,
/// so "recent studies" ordering reflects real work.
pub(crate) fn touch(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE studies SET updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}
