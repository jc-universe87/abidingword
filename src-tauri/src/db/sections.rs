use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{blocks, new_id, now, studies};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::domain::{
    BlockType, CreateStudySection, DeleteStudySection, Reorder, StudyPhase, StudySection,
    UpdateStudySection,
};
use crate::error::{AppError, AppResult, UserMessage};

const COLUMNS: &str =
    "id, study_id, key, title, guidance, position, created_at, updated_at, revision, phase";

fn from_row(row: &Row) -> rusqlite::Result<StudySection> {
    Ok(StudySection {
        id: row.get(0)?,
        study_id: row.get(1)?,
        key: row.get(2)?,
        title: row.get(3)?,
        guidance: row.get(4)?,
        position: row.get(5)?,
        blocks: Vec::new(),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        revision: row.get(8)?,
        // An unknown stored value reads as no phase: the part stays, unplaced.
        phase: row
            .get::<_, Option<String>>(9)?
            .and_then(|p| StudyPhase::parse(&p).ok()),
    })
}

/// Live sections of a study in order, each with its live blocks in order.
pub fn list(conn: &Connection, study_id: &str) -> AppResult<Vec<StudySection>> {
    studies::get(conn, study_id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM study_sections WHERE study_id = ?1 AND deleted_at IS NULL
         ORDER BY position, created_at"
    ))?;
    let mut sections: Vec<StudySection> = stmt
        .query_map([study_id], from_row)?
        .collect::<Result<_, _>>()?;

    let mut by_section: HashMap<String, Vec<_>> = HashMap::new();
    for block in blocks::list_for_study(conn, study_id)? {
        by_section
            .entry(block.section_id.clone())
            .or_default()
            .push(block);
    }
    for section in &mut sections {
        section.blocks = by_section.remove(&section.id).unwrap_or_default();
    }
    Ok(sections)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<StudySection> {
    let mut section = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM study_sections WHERE id = ?1 AND deleted_at IS NULL"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("section", id))?;
    section.blocks = blocks::list_for_section(conn, id)?;
    Ok(section)
}

/// A part as stored: where it comes from, its words and where it belongs.
pub(crate) struct NewSection<'a> {
    pub key: Option<&'a str>,
    pub title: &'a str,
    pub guidance: Option<&'a str>,
    pub phase: Option<StudyPhase>,
}

pub(crate) fn insert(
    conn: &Connection,
    study_id: &str,
    section: NewSection,
    position: i64,
    now: &str,
) -> AppResult<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO study_sections
             (id, study_id, key, title, guidance, phase, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            study_id,
            section.key,
            section.title,
            section.guidance,
            section.phase.map(StudyPhase::as_str),
            position,
            now
        ],
    )?;
    Ok(id)
}

/// Adds a section at the end of a study, with one empty paragraph.
pub fn create(conn: &Connection, input: &CreateStudySection) -> AppResult<StudySection> {
    studies::get(conn, &input.study_id)?;
    let title = validate::title(&input.title, "section")?;
    let guidance =
        validate::optional_text(input.guidance.as_deref(), DESCRIPTION_MAX_CHARS, "guidance")?;
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM study_sections
         WHERE study_id = ?1 AND deleted_at IS NULL",
        [&input.study_id],
        |r| r.get(0),
    )?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    // A part the template offers for later keeps its identity and its place in the movement.
    let key = input
        .key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty());
    let id = insert(
        &tx,
        &input.study_id,
        NewSection {
            key,
            title: &title,
            guidance: guidance.as_deref(),
            phase: input.phase,
        },
        position,
        &now,
    )?;
    blocks::insert(&tx, &id, BlockType::Paragraph, 0, "", &now)?;
    studies::touch(&tx, &input.study_id, &now)?;
    tx.commit()?;
    get(conn, &id)
}

/// Whether a section holds anything worth keeping: text in a block, or a
/// finding assigned to it.
pub fn has_content(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM study_blocks
                        WHERE section_id = ?1 AND deleted_at IS NULL AND trim(content) <> '')
             OR EXISTS (SELECT 1 FROM findings WHERE section_id = ?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?)
}

/// Removes a section (soft). One that still has content is only removed
/// with `force`; its blocks go with it, and its findings stay in the study
/// as study-level findings.
pub fn delete(conn: &Connection, input: &DeleteStudySection) -> AppResult<()> {
    let section = get(conn, &input.id)?;
    if !input.force && has_content(conn, &input.id)? {
        return Err(AppError::Conflict(
            UserMessage::new(
                "sections.hasContent",
                format!("“{}” still has writing or findings in it.", section.title),
            )
            .with("title", &section.title),
        ));
    }
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE study_blocks SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE section_id = ?1 AND deleted_at IS NULL",
        params![input.id, now],
    )?;
    tx.execute(
        "UPDATE findings SET section_id = NULL, updated_at = ?2, revision = revision + 1
         WHERE section_id = ?1 AND deleted_at IS NULL",
        params![input.id, now],
    )?;
    tx.execute(
        "UPDATE study_sections SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![input.id, now],
    )?;
    studies::touch(&tx, &section.study_id, &now)?;
    tx.commit()?;
    Ok(())
}

/// Puts a study's sections in the given order. The list must name exactly
/// the study's live sections.
pub fn reorder(conn: &Connection, input: &Reorder) -> AppResult<Vec<StudySection>> {
    studies::get(conn, &input.parent_id)?;
    let current: Vec<String> = list(conn, &input.parent_id)?
        .into_iter()
        .map(|s| s.id)
        .collect();
    crate::db::check_same_members(&current, &input.ids, "sections")?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    for (index, id) in input.ids.iter().enumerate() {
        tx.execute(
            "UPDATE study_sections SET position = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, index as i64, now],
        )?;
    }
    studies::touch(&tx, &input.parent_id, &now)?;
    tx.commit()?;
    list(conn, &input.parent_id)
}

pub fn update(conn: &Connection, input: &UpdateStudySection) -> AppResult<StudySection> {
    let current = get(conn, &input.id)?;
    let title = match &input.title {
        Some(title) => validate::title(title, "section")?,
        None => current.title,
    };
    let guidance = match &input.guidance {
        Some(text) => validate::optional_text(Some(text), DESCRIPTION_MAX_CHARS, "guidance")?,
        None => current.guidance,
    };
    let phase = match input.phase.as_deref() {
        Some("") => None,
        Some(value) => Some(StudyPhase::parse(value)?),
        None => current.phase,
    };
    let now = now();
    conn.execute(
        "UPDATE study_sections SET title = ?2, guidance = ?3, phase = ?4, updated_at = ?5,
             revision = revision + 1
         WHERE id = ?1",
        params![
            input.id,
            title,
            guidance,
            phase.map(StudyPhase::as_str),
            now
        ],
    )?;
    studies::touch(conn, &current.study_id, &now)?;
    get(conn, &input.id)
}
