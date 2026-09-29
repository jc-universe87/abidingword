//! Passages a study is about, stored in `passage_references` (owner: study).
//! Optional: topical and doctrinal studies may have none.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, studies};
use crate::error::{AppError, AppResult};
use crate::scripture::canon;
use crate::scripture::reference::{Point, ScriptureRef};
use crate::scripture::{AddStudyPassage, StudyPassage};

const SELECT: &str =
    "SELECT id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, created_at
     FROM passage_references";

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
    ))
}

type RawPassage = (
    String,
    String,
    String,
    u16,
    Option<u16>,
    Option<u16>,
    Option<u16>,
    String,
);

fn to_passage(raw: RawPassage) -> AppResult<StudyPassage> {
    let (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, created_at) = raw;
    let book = canon::by_code(&book)
        .ok_or_else(|| AppError::Unexpected(format!("passage {id} has unknown book {book}")))?;
    let start = Point {
        chapter: start_chapter,
        verse: start_verse,
    };
    let end = match end_chapter {
        Some(chapter) => Point {
            chapter,
            verse: end_verse,
        },
        None => start,
    };
    Ok(StudyPassage {
        id,
        study_id,
        reference: ScriptureRef::new(book, start, end)?.to_dto(),
        created_at,
    })
}

/// A study's passages in the order they were added (the first is primary).
pub fn list(conn: &Connection, study_id: &str) -> AppResult<Vec<StudyPassage>> {
    studies::get(conn, study_id)?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE study_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id"
    ))?;
    let rows = stmt.query_map([study_id], from_row)?;
    rows.map(|r| to_passage(r?)).collect()
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

/// Links a passage to a study. Adding the same passage twice returns the
/// existing link.
pub fn add(conn: &Connection, input: &AddStudyPassage) -> AppResult<StudyPassage> {
    studies::get(conn, &input.study_id)?;
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    if let Some(existing) = list(conn, &input.study_id)?
        .into_iter()
        .find(|p| p.reference.canonical == reference.canonical())
    {
        return Ok(existing);
    }
    let id = new_id();
    let now = now();
    let (end_chapter, end_verse) = if reference.start == reference.end {
        (None, None)
    } else {
        (Some(reference.end.chapter), reference.end.verse)
    };
    conn.execute(
        "INSERT INTO passage_references
             (id, study_id, book, start_chapter, start_verse, end_chapter, end_verse, label,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            input.study_id,
            reference.book.code,
            reference.start.chapter,
            reference.start.verse,
            end_chapter,
            end_verse,
            reference.display(),
            now
        ],
    )?;
    studies::touch(conn, &input.study_id, &now)?;
    get(conn, &id)
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
