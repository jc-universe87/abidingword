use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, workspaces};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::domain::{CreateProject, Project, UpdateProject};
use crate::error::{AppError, AppResult};

const SELECT: &str = "
    SELECT p.id, p.workspace_id, p.title, p.description,
           (SELECT COUNT(*) FROM studies s WHERE s.project_id = p.id AND s.deleted_at IS NULL),
           p.created_at, p.updated_at, p.revision
    FROM projects p";

fn from_row(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        study_count: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        revision: row.get(7)?,
    })
}

/// Live projects in a workspace, alphabetically.
pub fn list(conn: &Connection, workspace_id: &str) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE p.workspace_id = ?1 AND p.deleted_at IS NULL
         ORDER BY p.title COLLATE NOCASE, p.created_at"
    ))?;
    let rows = stmt.query_map([workspace_id], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Project> {
    conn.query_row(
        &format!("{SELECT} WHERE p.id = ?1 AND p.deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("project", id))
}

pub fn create(conn: &Connection, input: &CreateProject) -> AppResult<Project> {
    let title = validate::title(&input.title, "project")?;
    let description = validate::optional_text(
        input.description.as_deref(),
        DESCRIPTION_MAX_CHARS,
        "description",
    )?;
    workspaces::get(conn, &input.workspace_id)?;

    let id = new_id();
    let now = now();
    conn.execute(
        "INSERT INTO projects (id, workspace_id, title, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, input.workspace_id, title, description, now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, input: &UpdateProject) -> AppResult<Project> {
    let current = get(conn, &input.id)?;
    let title = match &input.title {
        Some(title) => validate::title(title, "project")?,
        None => current.title,
    };
    let description = match &input.description {
        Some(text) => validate::optional_text(Some(text), DESCRIPTION_MAX_CHARS, "description")?,
        None => current.description,
    };
    conn.execute(
        "UPDATE projects SET title = ?2, description = ?3, updated_at = ?4, revision = revision + 1
         WHERE id = ?1",
        params![input.id, title, description, now()],
    )?;
    get(conn, &input.id)
}
