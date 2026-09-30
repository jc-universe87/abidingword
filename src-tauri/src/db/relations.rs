//! Relations between studies ("Romans 8 — continues → Galatians 4"): the
//! start of long-term study memory. A relation is stored once, from one
//! study to another, and shown from both sides.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, studies};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::domain::{CreateStudyRelation, RelatedStudy, RelationType, StudyRelation, StudyType};
use crate::error::{AppError, AppResult};

type RawRelation = (
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    String,
    String,
    String,
    String,
);

fn view(row: &Row) -> rusqlite::Result<RawRelation> {
    Ok((
        row.get(0)?, // id
        row.get(1)?, // from
        row.get(2)?, // to
        row.get(3)?, // relation_type
        row.get(4)?, // note
        row.get(5)?, // created_at
        row.get(6)?, // other id
        row.get(7)?, // other project
        row.get(8)?, // other title
        row.get(9)?, // other type
    ))
}

/// Relations touching a study, in both directions, oldest first.
pub fn list(conn: &Connection, study_id: &str) -> AppResult<Vec<StudyRelation>> {
    studies::get(conn, study_id)?;
    let mut stmt = conn.prepare(
        "SELECT r.id, r.from_study_id, r.to_study_id, r.relation_type, r.note, r.created_at,
                o.id, o.project_id, o.title, o.study_type
         FROM study_relations r
         JOIN studies o ON o.id = CASE WHEN r.from_study_id = ?1 THEN r.to_study_id ELSE r.from_study_id END
         WHERE (r.from_study_id = ?1 OR r.to_study_id = ?1)
           AND r.deleted_at IS NULL AND o.deleted_at IS NULL
         ORDER BY r.created_at, r.rowid",
    )?;
    let rows = stmt.query_map([study_id], view)?;
    let mut relations = Vec::new();
    for row in rows {
        let (
            id,
            from,
            _to,
            relation_type,
            note,
            created_at,
            other_id,
            project_id,
            title,
            study_type,
        ) = row?;
        relations.push(StudyRelation {
            id,
            relation_type: RelationType::parse(&relation_type)?,
            direction: if from == study_id {
                "outgoing"
            } else {
                "incoming"
            },
            note,
            other: RelatedStudy {
                id: other_id,
                project_id,
                title,
                study_type: StudyType::parse(&study_type)?,
            },
            created_at,
        });
    }
    Ok(relations)
}

pub fn create(conn: &Connection, input: &CreateStudyRelation) -> AppResult<StudyRelation> {
    if input.from_study_id == input.to_study_id {
        return Err(AppError::InvalidInput(
            "A study can’t be linked to itself.".into(),
        ));
    }
    studies::get(conn, &input.from_study_id)?;
    let other = studies::get(conn, &input.to_study_id)?;
    let note = validate::optional_text(input.note.as_deref(), DESCRIPTION_MAX_CHARS, "note")?;
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM study_relations WHERE deleted_at IS NULL
             AND ((from_study_id = ?1 AND to_study_id = ?2) OR (from_study_id = ?2 AND to_study_id = ?1)))",
        params![input.from_study_id, input.to_study_id],
        |r| r.get(0),
    )?;
    if exists {
        return Err(AppError::Conflict(format!(
            "This study is already linked to “{}”.",
            other.title
        )));
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO study_relations (id, from_study_id, to_study_id, relation_type, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, input.from_study_id, input.to_study_id, input.relation_type.as_str(), note, now()],
    )?;
    list(conn, &input.from_study_id)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| AppError::Unexpected("relation vanished after insert".into()))
}

/// Soft delete.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let found: Option<String> = conn
        .query_row(
            "SELECT id FROM study_relations WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    if found.is_none() {
        return Err(AppError::not_found("link", id));
    }
    let now = now();
    conn.execute(
        "UPDATE study_relations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}
