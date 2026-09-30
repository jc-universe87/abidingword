//! Passages a study is about, stored in `passage_references` (owner: study),
//! each primary or related. Optional: topical and doctrinal studies may have
//! none; a study has at most one primary passage.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, studies};
use crate::domain::PassageRole;
use crate::error::{AppError, AppResult};
use crate::scripture::canon;
use crate::scripture::reference::{Point, ScriptureRef};
use crate::scripture::{AddStudyPassage, StudyPassage};

const SELECT: &str =
    "SELECT id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, \
     created_at, role FROM passage_references";

type RawPassage = (
    String,
    String,
    String,
    u16,
    Option<u16>,
    Option<u16>,
    Option<u16>,
    String,
    Option<String>,
);

fn from_row(row: &Row) -> rusqlite::Result<RawPassage> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

/// Rebuilds a canonical reference from `passage_references` columns
/// (shared with finding passages).
pub(crate) fn reference_from_columns(
    id: &str,
    book: &str,
    start: (u16, Option<u16>),
    end: (Option<u16>, Option<u16>),
) -> AppResult<ScriptureRef> {
    let book = canon::by_code(book)
        .ok_or_else(|| AppError::Unexpected(format!("passage {id} has unknown book {book}")))?;
    let start = Point {
        chapter: start.0,
        verse: start.1,
    };
    let end = match end.0 {
        Some(chapter) => Point {
            chapter,
            verse: end.1,
        },
        None => start,
    };
    ScriptureRef::new(book, start, end)
}

/// The column values that store a reference in `passage_references`.
pub(crate) fn columns_for(reference: &ScriptureRef) -> (Option<u16>, Option<u16>) {
    if reference.start == reference.end {
        (None, None)
    } else {
        (Some(reference.end.chapter), reference.end.verse)
    }
}

fn to_passage(raw: RawPassage) -> AppResult<StudyPassage> {
    let (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, created_at, role) =
        raw;
    let reference = reference_from_columns(
        &id,
        &book,
        (start_chapter, start_verse),
        (end_chapter, end_verse),
    )?;
    Ok(StudyPassage {
        role: match role.as_deref() {
            Some("primary") => PassageRole::Primary,
            _ => PassageRole::Related,
        },
        id,
        study_id,
        reference: reference.to_dto(),
        created_at,
    })
}

/// A study's passages: the primary first, then related in the order added.
pub fn list(conn: &Connection, study_id: &str) -> AppResult<Vec<StudyPassage>> {
    studies::get(conn, study_id)?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE study_id = ?1 AND deleted_at IS NULL
         ORDER BY (role = 'primary') DESC, created_at, rowid"
    ))?;
    let rows = stmt.query_map([study_id], from_row)?;
    rows.map(|r| to_passage(r?)).collect()
}

pub fn primary(conn: &Connection, study_id: &str) -> AppResult<Option<StudyPassage>> {
    let raw = conn
        .query_row(
            &format!("{SELECT} WHERE study_id = ?1 AND role = 'primary' AND deleted_at IS NULL"),
            [study_id],
            from_row,
        )
        .optional()?;
    raw.map(to_passage).transpose()
}

fn get(conn: &Connection, id: &str) -> AppResult<StudyPassage> {
    let raw = conn
        .query_row(
            &format!("{SELECT} WHERE id = ?1 AND study_id IS NOT NULL AND deleted_at IS NULL"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("passage", id))?;
    to_passage(raw)
}

fn demote_primary(conn: &Connection, study_id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE passage_references SET role = 'related', updated_at = ?2, revision = revision + 1
         WHERE study_id = ?1 AND role = 'primary' AND deleted_at IS NULL",
        params![study_id, now],
    )?;
    Ok(())
}

/// Links a passage to a study. Adding the same passage twice returns the
/// existing link (with its role changed if a different role was asked for).
pub fn add(conn: &Connection, input: &AddStudyPassage) -> AppResult<StudyPassage> {
    studies::get(conn, &input.study_id)?;
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    let now = now();
    let has_primary = primary(conn, &input.study_id)?.is_some();
    let role = input.role.unwrap_or(if has_primary {
        PassageRole::Related
    } else {
        PassageRole::Primary
    });

    if let Some(existing) = list(conn, &input.study_id)?
        .into_iter()
        .find(|p| p.reference.canonical == reference.canonical())
    {
        if input.role.is_some() && existing.role != role {
            return set_role(conn, &existing.id, role);
        }
        return Ok(existing);
    }

    if role == PassageRole::Primary {
        demote_primary(conn, &input.study_id, &now)?;
    }
    let id = new_id();
    let (end_chapter, end_verse) = columns_for(&reference);
    conn.execute(
        "INSERT INTO passage_references
             (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, label, role,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            input.study_id,
            reference.book.code,
            reference.start.chapter,
            reference.start.verse,
            end_chapter,
            end_verse,
            reference.display(),
            role.as_str(),
            now
        ],
    )?;
    studies::touch(conn, &input.study_id, &now)?;
    get(conn, &id)
}

/// Makes a passage primary (the old primary becomes related) or related.
pub fn set_role(conn: &Connection, id: &str, role: PassageRole) -> AppResult<StudyPassage> {
    let passage = get(conn, id)?;
    let now = now();
    if role == PassageRole::Primary {
        demote_primary(conn, &passage.study_id, &now)?;
    }
    conn.execute(
        "UPDATE passage_references SET role = ?2, updated_at = ?3, revision = revision + 1 WHERE id = ?1",
        params![id, role.as_str(), now],
    )?;
    studies::touch(conn, &passage.study_id, &now)?;
    get(conn, id)
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    let passage = get(conn, id)?;
    let now = now();
    conn.execute(
        "UPDATE passage_references SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![id, now],
    )?;
    studies::touch(conn, &passage.study_id, &now)
}
