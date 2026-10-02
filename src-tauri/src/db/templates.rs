//! Study templates: data-driven structure for new studies.
//!
//! Built-in templates ship as JSON in `resources/templates/`, compiled in
//! and installed or refreshed on every startup. They cannot be edited or
//! deleted; the user duplicates one to customise it. User templates live
//! only in the database. A template holds structure (ordered sections with
//! optional guidance), never study content. A study copies its template's
//! sections when created, so later template changes never alter it.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::domain::{
    StudyTemplate, StudyType, TemplateDefinition, TemplateInput, TemplateSection, UpdateTemplate,
};
use crate::error::{AppError, AppResult, UserMessage};

pub const DEFAULT_TEMPLATE_KEY: &str = "passage-study";

const MAX_SECTIONS: usize = 40;

const BUILTIN: &[&str] = &[
    include_str!("../../../resources/templates/passage-study.json"),
    include_str!("../../../resources/templates/word-study.json"),
    include_str!("../../../resources/templates/topical-study.json"),
    include_str!("../../../resources/templates/biblical-theology-study.json"),
    include_str!("../../../resources/templates/systematic-theology-study.json"),
    include_str!("../../../resources/templates/teaching-study.json"),
];

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredDefinition {
    sections: Vec<TemplateSection>,
}

const COLUMNS: &str = "id, key, name, description, study_type, is_builtin, definition, \
                       created_at, updated_at, revision";

fn from_row(row: &Row) -> rusqlite::Result<StudyTemplate> {
    let conversion = |index: usize, e: AppError| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, e.into())
    };
    let study_type: String = row.get(4)?;
    let definition: String = row.get(6)?;
    let stored: StoredDefinition = serde_json::from_str(&definition)
        .map_err(|e| conversion(6, AppError::Unexpected(format!("template JSON: {e}"))))?;
    Ok(StudyTemplate {
        id: row.get(0)?,
        key: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        study_type: StudyType::parse(&study_type).map_err(|e| conversion(4, e))?,
        is_builtin: row.get(5)?,
        sections: stored.sections,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        revision: row.get(9)?,
    })
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

/// The built-in template key suggested for a study type (none for custom).
pub fn builtin_key_for(study_type: StudyType) -> Option<&'static str> {
    match study_type {
        StudyType::Passage => Some("passage-study"),
        StudyType::Word => Some("word-study"),
        StudyType::Topical => Some("topical-study"),
        StudyType::BiblicalTheology => Some("biblical-theology-study"),
        StudyType::SystematicTheology => Some("systematic-theology-study"),
        StudyType::Teaching => Some("teaching-study"),
        StudyType::Custom => None,
    }
}

fn to_json(sections: &[TemplateSection]) -> AppResult<String> {
    serde_json::to_string(&StoredDefinition {
        sections: sections.to_vec(),
    })
    .map_err(|e| AppError::Unexpected(e.to_string()))
}

pub fn ensure_builtin(conn: &Connection) -> AppResult<()> {
    for template in builtin_definitions()? {
        let definition = to_json(&template.sections)?;
        let changed = conn.execute(
            "INSERT INTO study_templates
                 (id, key, name, description, study_type, is_builtin, definition, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?7)
             ON CONFLICT (key) DO UPDATE SET
                 name = excluded.name,
                 description = excluded.description,
                 study_type = excluded.study_type,
                 definition = excluded.definition,
                 deleted_at = NULL,
                 updated_at = excluded.updated_at,
                 revision = revision + 1
             WHERE is_builtin = 1
               AND (name, description, study_type, definition, deleted_at)
                   IS NOT (excluded.name, excluded.description, excluded.study_type,
                           excluded.definition, NULL)",
            params![
                new_id(),
                template.key,
                template.name,
                template.description,
                template.study_type.as_str(),
                definition,
                now()
            ],
        )?;
        if changed > 0 {
            log::info!("installed built-in template {}", template.key);
        }
    }
    Ok(())
}

/// Live templates: built-in first (in shipped order), then the user's by name.
pub fn list(conn: &Connection) -> AppResult<Vec<StudyTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM study_templates WHERE deleted_at IS NULL
         ORDER BY is_builtin DESC, name COLLATE NOCASE"
    ))?;
    let mut templates: Vec<StudyTemplate> =
        stmt.query_map([], from_row)?.collect::<Result<_, _>>()?;
    let order: Vec<String> = builtin_definitions()?.into_iter().map(|t| t.key).collect();
    templates.sort_by_key(|t| {
        (
            !t.is_builtin,
            order.iter().position(|k| *k == t.key).unwrap_or(usize::MAX),
        )
    });
    Ok(templates)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<StudyTemplate> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM study_templates WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("template", id))
}

pub fn get_by_key(conn: &Connection, key: &str) -> AppResult<StudyTemplate> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM study_templates WHERE key = ?1 AND deleted_at IS NULL"),
        [key],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("template", key))
}

fn validated(input: &TemplateInput) -> AppResult<(String, Option<String>, Vec<TemplateSection>)> {
    let name = validate::title(&input.name, "template")?;
    let description = validate::optional_text(
        input.description.as_deref(),
        DESCRIPTION_MAX_CHARS,
        "description",
    )?;
    if input.sections.is_empty() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "templates.noSections",
            "A template needs at least one section.",
        )));
    }
    if input.sections.len() > MAX_SECTIONS {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "templates.tooManySections",
                format!("A template can have at most {MAX_SECTIONS} sections."),
            )
            .with("max", MAX_SECTIONS),
        ));
    }
    let sections = input
        .sections
        .iter()
        .map(|s| {
            Ok(TemplateSection {
                key: s.key.clone().filter(|k| !k.trim().is_empty()),
                title: validate::title(&s.title, "section")?,
                guidance: validate::optional_text(
                    s.guidance.as_deref(),
                    DESCRIPTION_MAX_CHARS,
                    "guidance",
                )?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok((name, description, sections))
}

pub fn create(conn: &Connection, input: &TemplateInput) -> AppResult<StudyTemplate> {
    let (name, description, sections) = validated(input)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO study_templates
             (id, key, name, description, study_type, is_builtin, definition, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?7)",
        params![
            id,
            format!("user-{id}"),
            name,
            description,
            input.study_type.as_str(),
            to_json(&sections)?,
            now()
        ],
    )?;
    get(conn, &id)
}

fn require_user_template(conn: &Connection, id: &str) -> AppResult<StudyTemplate> {
    let template = get(conn, id)?;
    if template.is_builtin {
        return Err(AppError::Conflict(UserMessage::new(
            "templates.builtinReadOnly",
            "Built-in templates can’t be changed. Duplicate it to make your own version.",
        )));
    }
    Ok(template)
}

pub fn update(conn: &Connection, input: &UpdateTemplate) -> AppResult<StudyTemplate> {
    require_user_template(conn, &input.id)?;
    let (name, description, sections) = validated(&input.template)?;
    conn.execute(
        "UPDATE study_templates SET name = ?2, description = ?3, study_type = ?4, definition = ?5,
             updated_at = ?6, revision = revision + 1
         WHERE id = ?1",
        params![
            input.id,
            name,
            description,
            input.template.study_type.as_str(),
            to_json(&sections)?,
            now()
        ],
    )?;
    get(conn, &input.id)
}

/// Copies any template (built-in or not) into a new user template.
pub fn duplicate(conn: &Connection, id: &str) -> AppResult<StudyTemplate> {
    let original = get(conn, id)?;
    let mut name = format!("{} (copy)", original.name);
    if name.chars().count() > validate::TITLE_MAX_CHARS {
        name = original.name.clone();
    }
    create(
        conn,
        &TemplateInput {
            name,
            description: original.description,
            study_type: original.study_type,
            sections: original.sections,
        },
    )
}

/// Deletes a user template (soft). Studies made from it keep their sections.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    require_user_template(conn, id)?;
    let now = now();
    conn.execute(
        "UPDATE study_templates SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}
