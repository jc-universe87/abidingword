//! Scripture annotations: notes, highlights and bookmarks on a canonical
//! passage. They belong to the passage, not to a translation, so they stay
//! in place when the reader switches translation or a translation is removed.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, workspaces};
use crate::error::{AppError, AppResult};
use crate::scripture::reference::ScriptureRef;
use crate::scripture::{Annotation, CreateAnnotation, UpdateAnnotation, ANNOTATION_KINDS};

const COLUMNS: &str =
    "id, passage, translation_id, kind, content, created_at, updated_at, revision";

const CONTENT_MAX_CHARS: usize = 20_000;

fn from_row(row: &Row) -> rusqlite::Result<RawAnnotation> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
    ))
}

type RawAnnotation = (
    String,
    String,
    Option<String>,
    String,
    String,
    String,
    String,
    i64,
);

fn to_annotation(raw: RawAnnotation) -> AppResult<Annotation> {
    let (id, passage, translation_id, kind, content, created_at, updated_at, revision) = raw;
    Ok(Annotation {
        id,
        reference: ScriptureRef::from_canonical(&passage)?.to_dto(),
        translation_id,
        kind,
        content,
        created_at,
        updated_at,
        revision,
    })
}

/// Live annotations overlapping a passage, in canonical order.
pub fn list(conn: &Connection, reference: &ScriptureRef) -> AppResult<Vec<Annotation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM annotations
         WHERE deleted_at IS NULL AND passage IS NOT NULL
           AND start_key <= ?2 AND end_key >= ?1
         ORDER BY start_key, created_at"
    ))?;
    let rows = stmt.query_map(
        params![reference.start_key(), reference.end_key()],
        from_row,
    )?;
    rows.map(|r| to_annotation(r?)).collect()
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Annotation> {
    let raw = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM annotations WHERE id = ?1 AND deleted_at IS NULL AND passage IS NOT NULL"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("note", id))?;
    to_annotation(raw)
}

/// Creates an annotation. A highlight or bookmark that already exists on
/// exactly this passage is returned instead of duplicated.
pub fn create(conn: &Connection, input: &CreateAnnotation) -> AppResult<Annotation> {
    if !ANNOTATION_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::InvalidInput(format!(
            "“{}” is not a kind of annotation.",
            input.kind
        )));
    }
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    let content = input.content.clone().unwrap_or_default();
    if content.chars().count() > CONTENT_MAX_CHARS {
        return Err(AppError::InvalidInput(
            "This note is too long to save.".into(),
        ));
    }
    if let Some(translation) = &input.translation_id {
        crate::db::bibles::get(conn, translation)?;
    }
    if input.kind != "note" {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM annotations
                 WHERE deleted_at IS NULL AND passage = ?1 AND kind = ?2",
                params![reference.canonical(), input.kind],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return get(conn, &id);
        }
    }
    let workspace = workspaces::get_default(conn)?;
    let id = new_id();
    let now = now();
    conn.execute(
        "INSERT INTO annotations
             (id, workspace_id, passage, start_key, end_key, translation_id, kind, content,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            workspace.id,
            reference.canonical(),
            reference.start_key(),
            reference.end_key(),
            input.translation_id,
            input.kind,
            content,
            now
        ],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, input: &UpdateAnnotation) -> AppResult<Annotation> {
    get(conn, &input.id)?;
    if input.content.chars().count() > CONTENT_MAX_CHARS {
        return Err(AppError::InvalidInput(
            "This note is too long to save.".into(),
        ));
    }
    conn.execute(
        "UPDATE annotations SET content = ?2, updated_at = ?3, revision = revision + 1 WHERE id = ?1",
        params![input.id, input.content, now()],
    )?;
    get(conn, &input.id)
}

/// Soft delete: hidden everywhere, kept in the file.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    get(conn, id)?;
    let now = now();
    conn.execute(
        "UPDATE annotations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}
