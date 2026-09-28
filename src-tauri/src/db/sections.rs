use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{blocks, new_id, now, studies};
use crate::domain::{validate, StudySection, UpdateStudySection};
use crate::error::{AppError, AppResult};

const COLUMNS: &str =
    "id, study_id, key, title, guidance, position, created_at, updated_at, revision";

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

pub(crate) fn insert(
    conn: &Connection,
    study_id: &str,
    key: Option<&str>,
    title: &str,
    guidance: Option<&str>,
    position: i64,
    now: &str,
) -> AppResult<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO study_sections
             (id, study_id, key, title, guidance, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, study_id, key, title, guidance, position, now],
    )?;
    Ok(id)
}

pub fn update(conn: &Connection, input: &UpdateStudySection) -> AppResult<StudySection> {
    let current = get(conn, &input.id)?;
    let title = match &input.title {
        Some(title) => validate::title(title, "section")?,
        None => current.title,
    };
    let now = now();
    conn.execute(
        "UPDATE study_sections SET title = ?2, updated_at = ?3, revision = revision + 1
         WHERE id = ?1",
        params![input.id, title, now],
    )?;
    studies::touch(conn, &current.study_id, &now)?;
    get(conn, &input.id)
}
