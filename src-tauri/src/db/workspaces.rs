//! Workspaces. v0.1 has exactly one: the local default workspace.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now};
use crate::domain::Workspace;
use crate::error::{AppError, AppResult};

pub const DEFAULT_WORKSPACE_NAME: &str = "My Workspace";

const COLUMNS: &str = "id, name, is_default, created_at, updated_at, revision";

fn from_row(row: &Row) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        is_default: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        revision: row.get(5)?,
    })
}

/// Creates the default workspace if it does not exist yet.
pub fn ensure_default(conn: &Connection) -> AppResult<Workspace> {
    if let Some(existing) = find_default(conn)? {
        return Ok(existing);
    }
    let now = now();
    conn.execute(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at)
         VALUES (?1, ?2, 1, ?3, ?3)",
        params![new_id(), DEFAULT_WORKSPACE_NAME, now],
    )?;
    log::info!("created default workspace");
    get_default(conn)
}

pub fn get_default(conn: &Connection) -> AppResult<Workspace> {
    find_default(conn)?.ok_or_else(|| AppError::not_found("workspace", "default"))
}

fn find_default(conn: &Connection) -> AppResult<Option<Workspace>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM workspaces WHERE is_default = 1 AND deleted_at IS NULL"
            ),
            [],
            from_row,
        )
        .optional()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Workspace> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM workspaces WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("workspace", id))
}
