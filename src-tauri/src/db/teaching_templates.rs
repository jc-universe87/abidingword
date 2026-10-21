//! Bible Teaching templates of the person's own (v0.18.7).
//!
//! A template is a starting structure for a teaching: its format and the
//! points, questions or steps it starts with. The built-in ones are
//! application text in the interface (`resources/teaching-templates.json`)
//! and are never stored, so they cannot be changed here. A teaching copies
//! its template's points when it is made (`teaching_create`) and is never
//! linked to the template afterwards: editing or deleting a template never
//! changes a teaching. Deleting is soft, like the other templates.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::teaching::{check_kind, check_step_kind, point_title, STARTING_POINTS_MAX};
use crate::db::{new_id, now};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::domain::{
    TeachingTemplate, TeachingTemplateInput, TeachingTemplatePoint, UpdateTeachingTemplate,
};
use crate::error::{AppError, AppResult, UserMessage};

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredDefinition {
    points: Vec<TeachingTemplatePoint>,
}

const COLUMNS: &str = "id, name, description, kind, definition, created_at, updated_at, revision";

fn from_row(row: &Row) -> rusqlite::Result<TeachingTemplate> {
    let definition: String = row.get(4)?;
    let stored: StoredDefinition = serde_json::from_str(&definition).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            AppError::Unexpected(format!("teaching template JSON: {e}")).into(),
        )
    })?;
    Ok(TeachingTemplate {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        kind: row.get(3)?,
        points: stored.points,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        revision: row.get(7)?,
    })
}

/// The person's templates, by name.
pub fn list(conn: &Connection) -> AppResult<Vec<TeachingTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM teaching_templates WHERE deleted_at IS NULL
         ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let templates = stmt
        .query_map([], from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(templates)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<TeachingTemplate> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM teaching_templates WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("teaching template", id))
}

fn validated(input: &TeachingTemplateInput) -> AppResult<(String, Option<String>, String, String)> {
    let name = validate::title(&input.name, "template")?;
    let description = validate::optional_text(
        input.description.as_deref(),
        DESCRIPTION_MAX_CHARS,
        "description",
    )?;
    let kind = check_kind(Some(&input.kind))?.ok_or_else(|| {
        AppError::InvalidInput(UserMessage::new(
            "teachingTemplates.noKind",
            "Choose what the template is for.",
        ))
    })?;
    if input.points.len() > STARTING_POINTS_MAX {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "teachingTemplates.tooManyPoints",
                format!("A template can start with at most {STARTING_POINTS_MAX} points or steps."),
            )
            .with("max", STARTING_POINTS_MAX),
        ));
    }
    let points = input
        .points
        .iter()
        .map(|p| {
            Ok(TeachingTemplatePoint {
                key: validate::part_key(p.key.as_deref())?,
                title: point_title(&p.title)?,
                kind: check_step_kind(p.kind.as_deref())?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let definition = serde_json::to_string(&StoredDefinition { points })
        .map_err(|e| AppError::Unexpected(format!("teaching template JSON: {e}")))?;
    Ok((name, description, kind, definition))
}

pub fn create(conn: &Connection, input: &TeachingTemplateInput) -> AppResult<TeachingTemplate> {
    let (name, description, kind, definition) = validated(input)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO teaching_templates (id, name, description, kind, definition, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, name, description, kind, definition, now()],
    )?;
    get(conn, &id)
}

/// Changes the template only: teachings already made from it keep their own points.
pub fn update(conn: &Connection, input: &UpdateTeachingTemplate) -> AppResult<TeachingTemplate> {
    get(conn, &input.id)?;
    let (name, description, kind, definition) = validated(&input.template)?;
    conn.execute(
        "UPDATE teaching_templates SET name = ?2, description = ?3, kind = ?4, definition = ?5,
             updated_at = ?6, revision = revision + 1
         WHERE id = ?1",
        params![input.id, name, description, kind, definition, now()],
    )?;
    get(conn, &input.id)
}

/// Deletes the template (soft). Teachings made from it are not touched.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    get(conn, id)?;
    let now = now();
    conn.execute(
        "UPDATE teaching_templates SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}
