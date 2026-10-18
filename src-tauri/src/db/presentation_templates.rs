//! Church presentation templates (v0.18.1): kept once, chosen by any number
//! of presentations. Nothing here touches a teaching or a presentation's
//! slides; deleting a template returns the presentations that used it to
//! their built-in background.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now};
use crate::domain::validate;
use crate::domain::{
    CreatePresentationTemplate, PresentationTemplate, PresentationTemplateSummary,
    UpdatePresentationTemplate,
};
use crate::error::{AppError, AppResult, UserMessage};
use crate::presentation::template::{self, TemplateDefinition};

/// How a template was made.
pub const SOURCE_FORMATS: &[&str] = &["pptx", "package", "designer"];
/// A description is at most this long.
const DESCRIPTION_MAX: usize = 2000;

const COLUMNS: &str = "id, name, description, definition, source_format, source_name, report, \
                       created_at, updated_at, revision";

fn definition(text: &str) -> rusqlite::Result<TemplateDefinition> {
    serde_json::from_str(text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })
}

fn from_row(row: &Row) -> rusqlite::Result<PresentationTemplate> {
    let report: Option<String> = row.get(6)?;
    Ok(PresentationTemplate {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        definition: definition(&row.get::<_, String>(3)?)?,
        source_format: row.get(4)?,
        source_name: row.get(5)?,
        report: report.and_then(|r| serde_json::from_str(&r).ok()),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        revision: row.get(9)?,
    })
}

fn not_found(id: &str) -> AppError {
    AppError::NotFound {
        entity: "presentation template",
        id: id.to_string(),
    }
}

fn description(text: &str) -> AppResult<String> {
    if text.chars().count() > DESCRIPTION_MAX {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.tooLong",
            "This text is too long to save.",
        )));
    }
    Ok(text.trim().to_string())
}

fn json(def: &TemplateDefinition) -> AppResult<String> {
    serde_json::to_string(def).map_err(|e| AppError::Unexpected(format!("template: {e}")))
}

pub fn list(conn: &Connection) -> AppResult<Vec<PresentationTemplateSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM presentation_templates WHERE deleted_at IS NULL
         ORDER BY name COLLATE NOCASE, created_at, rowid"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    let mut out = Vec::new();
    for t in rows {
        let t = t?;
        out.push(PresentationTemplateSummary {
            id: t.id,
            name: t.name,
            description: t.description,
            width: t.definition.width,
            height: t.definition.height,
            source_format: t.source_format,
            updated_at: t.updated_at,
        });
    }
    Ok(out)
}

/// A template that is still there.
pub fn get(conn: &Connection, id: &str) -> AppResult<PresentationTemplate> {
    conn.query_row(
        &format!(
            "SELECT {COLUMNS} FROM presentation_templates WHERE id = ?1 AND deleted_at IS NULL"
        ),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| not_found(id))
}

pub fn create(
    conn: &Connection,
    input: &CreatePresentationTemplate,
) -> AppResult<PresentationTemplate> {
    let name = validate::title(&input.name, "template")?;
    let description = description(&input.description)?;
    template::validate(&input.definition)?;
    let source = if SOURCE_FORMATS.contains(&input.source_format.as_str()) {
        input.source_format.clone()
    } else {
        "designer".to_string()
    };
    let report = input
        .report
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| AppError::Unexpected(format!("template report: {e}")))?;
    let id = new_id();
    let now = now();
    conn.execute(
        "INSERT INTO presentation_templates (id, name, description, definition, source_format,
             source_name, report, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            name,
            description,
            json(&input.definition)?,
            source,
            input.source_name.as_deref().map(str::trim),
            report,
            now
        ],
    )?;
    get(conn, &id)
}

pub fn update(
    conn: &Connection,
    input: &UpdatePresentationTemplate,
) -> AppResult<PresentationTemplate> {
    let current = get(conn, &input.id)?;
    let name = match &input.name {
        Some(n) => validate::title(n, "template")?,
        None => current.name,
    };
    let description = match &input.description {
        Some(d) => self::description(d)?,
        None => current.description,
    };
    let def = match &input.definition {
        Some(d) => {
            template::validate(d)?;
            d.clone()
        }
        None => current.definition,
    };
    conn.execute(
        "UPDATE presentation_templates SET name = ?2, description = ?3, definition = ?4,
             updated_at = ?5, revision = revision + 1
         WHERE id = ?1",
        params![input.id, name, description, json(&def)?, now()],
    )?;
    get(conn, &input.id)
}

/// Soft delete. Presentations that used it go back to their built-in
/// background; their slides are untouched.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    get(conn, id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE presentation_templates SET deleted_at = ?2, updated_at = ?2,
             revision = revision + 1
         WHERE id = ?1",
        params![id, now],
    )?;
    tx.execute(
        "UPDATE presentations SET template_id = NULL, updated_at = ?2, revision = revision + 1
         WHERE template_id = ?1",
        params![id, now],
    )?;
    tx.commit()?;
    Ok(())
}

/// The definition a presentation uses, when it uses a template that is
/// still there.
pub fn for_presentation(
    conn: &Connection,
    template_id: Option<&str>,
) -> AppResult<Option<PresentationTemplate>> {
    match template_id {
        Some(id) => match get(conn, id) {
            Ok(t) => Ok(Some(t)),
            Err(AppError::NotFound { .. }) => Ok(None),
            Err(e) => Err(e),
        },
        None => Ok(None),
    }
}
