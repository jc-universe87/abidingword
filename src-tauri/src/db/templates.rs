//! Study templates. Built-in templates ship as JSON in `resources/templates/`
//! and are installed or refreshed on every startup. Refreshing a template
//! never touches existing studies, because studies copy their sections.

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{new_id, now};
use crate::domain::{StudyTemplate, TemplateDefinition, TemplateSection};
use crate::error::{AppError, AppResult};

pub const DEFAULT_TEMPLATE_KEY: &str = "passage-study";

const BUILTIN: &[&str] = &[include_str!(
    "../../../resources/templates/passage-study.json"
)];

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredDefinition {
    sections: Vec<TemplateSection>,
}

pub fn builtin_definitions() -> AppResult<Vec<TemplateDefinition>> {
    BUILTIN
        .iter()
        .map(|json| {
            serde_json::from_str(json)
                .map_err(|e| AppError::Unexpected(format!("invalid built-in template: {e}")))
        })
        .collect()
}

pub fn ensure_builtin(conn: &Connection) -> AppResult<()> {
    for template in builtin_definitions()? {
        let definition = serde_json::to_string(&StoredDefinition {
            sections: template.sections.clone(),
        })
        .map_err(|e| AppError::Unexpected(e.to_string()))?;
        let now = now();
        let changed = conn.execute(
            "INSERT INTO study_templates
                 (id, key, name, description, is_builtin, definition, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)
             ON CONFLICT (key) DO UPDATE SET
                 name = excluded.name,
                 description = excluded.description,
                 definition = excluded.definition,
                 updated_at = excluded.updated_at,
                 revision = revision + 1
             WHERE is_builtin = 1
               AND (name, description, definition)
                   IS NOT (excluded.name, excluded.description, excluded.definition)",
            params![
                new_id(),
                template.key,
                template.name,
                template.description,
                definition,
                now
            ],
        )?;
        if changed > 0 {
            log::info!("installed built-in template {}", template.key);
        }
    }
    Ok(())
}

pub fn get_by_key(conn: &Connection, key: &str) -> AppResult<StudyTemplate> {
    let row = conn
        .query_row(
            "SELECT id, key, name, description, is_builtin, definition
             FROM study_templates WHERE key = ?1 AND deleted_at IS NULL",
            [key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("template", key))?;

    let (id, key, name, description, is_builtin, definition) = row;
    let stored: StoredDefinition = serde_json::from_str(&definition)
        .map_err(|e| AppError::Unexpected(format!("template {key} has invalid JSON: {e}")))?;
    Ok(StudyTemplate {
        id,
        key,
        name,
        description,
        is_builtin,
        sections: stored.sections,
    })
}
