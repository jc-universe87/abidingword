use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{blocks, new_id, now, projects, sections, templates};
use crate::domain::{validate, BlockType, CreateStudy, Study, StudyDetail, UpdateStudy};
use crate::error::{AppError, AppResult};

const COLUMNS: &str = "id, project_id, template_id, title, created_at, updated_at, revision";

fn from_row(row: &Row) -> rusqlite::Result<Study> {
    Ok(Study {
        id: row.get(0)?,
        project_id: row.get(1)?,
        template_id: row.get(2)?,
        title: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        revision: row.get(6)?,
    })
}

/// Live studies in a project, most recently changed first.
pub fn list(conn: &Connection, project_id: &str) -> AppResult<Vec<Study>> {
    projects::get(conn, project_id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM studies WHERE project_id = ?1 AND deleted_at IS NULL
         ORDER BY updated_at DESC, title COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([project_id], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
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

/// Creates a study with the sections of its template, each holding one empty
/// paragraph so the user can start writing straight away.
pub fn create(conn: &Connection, input: &CreateStudy) -> AppResult<StudyDetail> {
    let title = validate::title(&input.title, "study")?;
    projects::get(conn, &input.project_id)?;
    let template_key = input
        .template_key
        .as_deref()
        .unwrap_or(templates::DEFAULT_TEMPLATE_KEY);
    let template = templates::get_by_key(conn, template_key)?;

    let id = new_id();
    let now = now();
    // The connection is behind a mutex, so no other transaction can be open.
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO studies (id, project_id, template_id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, input.project_id, template.id, title, now],
    )?;
    for (index, section) in template.sections.iter().enumerate() {
        let section_id = sections::insert(
            &tx,
            &id,
            Some(&section.key),
            &section.title,
            section.guidance.as_deref(),
            index as i64,
            &now,
        )?;
        blocks::insert(&tx, &section_id, BlockType::Paragraph, 0, "", &now)?;
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
    conn.execute(
        "UPDATE studies SET title = ?2, updated_at = ?3, revision = revision + 1 WHERE id = ?1",
        params![input.id, title, now()],
    )?;
    get(conn, &input.id)
}

/// Marks a study as changed when its sections or blocks change, so "recent
/// studies" ordering reflects real work.
pub(crate) fn touch(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE studies SET updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}
