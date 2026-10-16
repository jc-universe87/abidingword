//! Teaching preparations (v0.16): the person's own teaching written from a
//! study. Findings are linked, never copied; Scripture is named by canonical
//! reference and never added to the study's passages; what is kept from the
//! assistant is stored apart, with its standing and sources.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::study_passages::{columns_for, reference_from_columns};
use crate::db::{findings, new_id, now, studies};
use crate::domain::validate::{self, BLOCK_MAX_CHARS, DESCRIPTION_MAX_CHARS};
use crate::domain::{
    AddTeachingPassage, CreateTeaching, CreateTeachingPoint, ExternalSource, ImageInfo,
    KeepTeachingMaterial, LinkTeachingFinding, Reorder, TeachingFindingLink, TeachingMaterial,
    TeachingPassage, TeachingPoint, TeachingPreparation, TeachingSummary, UpdateTeaching,
    UpdateTeachingPoint, MATERIAL_KINDS, MATERIAL_STANDINGS, TEACHING_KINDS,
};
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::reference::ScriptureRef;

const COLUMNS: &str = "id, study_id, title, kind, audience, purpose, central_message, \
                       introduction, conclusion, notes, created_at, updated_at, revision";

/// How many sources a kept item may carry, and how long each part may be.
const SOURCES_MAX: usize = 10;
const SOURCE_TEXT_MAX: usize = 2_000;

fn from_row(row: &Row) -> rusqlite::Result<TeachingPreparation> {
    Ok(TeachingPreparation {
        id: row.get(0)?,
        study_id: row.get(1)?,
        title: row.get(2)?,
        kind: row.get(3)?,
        audience: row.get(4)?,
        purpose: row.get(5)?,
        central_message: row.get(6)?,
        introduction: row.get(7)?,
        conclusion: row.get(8)?,
        notes: row.get(9)?,
        points: Vec::new(),
        findings: Vec::new(),
        passages: Vec::new(),
        materials: Vec::new(),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        revision: row.get(12)?,
    })
}

fn invalid(code: &'static str, text: &str) -> AppError {
    AppError::InvalidInput(UserMessage::new(code, text))
}

fn check_kind(kind: Option<&str>) -> AppResult<Option<String>> {
    match kind.map(str::trim).filter(|k| !k.is_empty()) {
        None => Ok(None),
        Some(k) if TEACHING_KINDS.contains(&k) => Ok(Some(k.to_string())),
        Some(other) => Err(AppError::InvalidInput(
            UserMessage::new(
                "invalidChoice",
                format!("“{other}” is not a valid teaching kind."),
            )
            .with("value", other),
        )),
    }
}

fn long_text(value: &str) -> AppResult<String> {
    if value.chars().count() > BLOCK_MAX_CHARS {
        return Err(invalid(
            "teaching.tooLong",
            "This part of the teaching is too long to save.",
        ));
    }
    Ok(value.to_string())
}

// ---------------------------------------------------------------------------
// Preparations
// ---------------------------------------------------------------------------

/// A study's preparations, in the order they were made.
pub fn list(conn: &Connection, study_id: &str) -> AppResult<Vec<TeachingSummary>> {
    studies::get(conn, study_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, study_id, title, kind, updated_at FROM teaching_preparations
         WHERE study_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at, rowid",
    )?;
    let rows = stmt.query_map([study_id], |row| {
        Ok(TeachingSummary {
            id: row.get(0)?,
            study_id: row.get(1)?,
            title: row.get(2)?,
            kind: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn row(conn: &Connection, id: &str) -> AppResult<TeachingPreparation> {
    conn.query_row(
        &format!(
            "SELECT {COLUMNS} FROM teaching_preparations WHERE id = ?1 AND deleted_at IS NULL"
        ),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("teaching preparation", id))
}

/// A preparation with its points, findings (as they are now), passages and
/// kept material.
pub fn get(conn: &Connection, id: &str) -> AppResult<TeachingPreparation> {
    let mut prep = row(conn, id)?;
    prep.points = points_for(conn, id)?;
    prep.findings = findings_for(conn, id)?;
    prep.passages = passages_for(conn, id)?;
    prep.materials = materials_for(conn, id)?;
    Ok(prep)
}

pub fn create(conn: &Connection, input: &CreateTeaching) -> AppResult<TeachingPreparation> {
    studies::get(conn, &input.study_id)?;
    let title = validate::title(&input.title, "teaching")?;
    let kind = check_kind(input.kind.as_deref())?;
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM teaching_preparations
         WHERE study_id = ?1 AND deleted_at IS NULL",
        [&input.study_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO teaching_preparations (id, study_id, title, kind, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, input.study_id, title, kind, position, now],
    )?;
    studies::touch(&tx, &input.study_id, &now)?;
    tx.commit()?;
    get(conn, &id)
}

pub fn update(conn: &Connection, input: &UpdateTeaching) -> AppResult<TeachingPreparation> {
    let current = row(conn, &input.id)?;
    let title = match &input.title {
        Some(t) => validate::title(t, "teaching")?,
        None => current.title,
    };
    let kind = match &input.kind {
        Some(k) => check_kind(Some(k))?,
        None => current.kind,
    };
    let short = |value: &Option<String>, current: Option<String>, what: &str| match value {
        Some(v) => validate::optional_text(Some(v), DESCRIPTION_MAX_CHARS, what),
        None => Ok(current),
    };
    let audience = short(&input.audience, current.audience, "audience")?;
    let purpose = short(&input.purpose, current.purpose, "purpose")?;
    let central_message = short(&input.central_message, current.central_message, "message")?;
    let long = |value: &Option<String>, current: String| match value {
        Some(v) => long_text(v),
        None => Ok(current),
    };
    let introduction = long(&input.introduction, current.introduction)?;
    let conclusion = long(&input.conclusion, current.conclusion)?;
    let notes = long(&input.notes, current.notes)?;
    let now = now();
    conn.execute(
        "UPDATE teaching_preparations SET title = ?2, kind = ?3, audience = ?4, purpose = ?5,
             central_message = ?6, introduction = ?7, conclusion = ?8, notes = ?9,
             updated_at = ?10, revision = revision + 1
         WHERE id = ?1",
        params![
            input.id,
            title,
            kind,
            audience,
            purpose,
            central_message,
            introduction,
            conclusion,
            notes,
            now
        ],
    )?;
    studies::touch(conn, &current.study_id, &now)?;
    get(conn, &input.id)
}

/// Soft delete. The study, its findings and its passages are untouched.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let current = row(conn, id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE teaching_preparations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![id, now],
    )?;
    studies::touch(&tx, &current.study_id, &now)?;
    tx.commit()?;
    Ok(())
}

fn touch(conn: &Connection, prep: &TeachingPreparation, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE teaching_preparations SET updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![prep.id, now],
    )?;
    studies::touch(conn, &prep.study_id, now)
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

fn points_for(conn: &Connection, prep_id: &str) -> AppResult<Vec<TeachingPoint>> {
    let mut stmt = conn.prepare(
        "SELECT id, position, title, explanation, application, illustration FROM teaching_points
         WHERE preparation_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at, rowid",
    )?;
    let rows = stmt.query_map([prep_id], |row| {
        Ok(TeachingPoint {
            id: row.get(0)?,
            position: row.get(1)?,
            title: row.get(2)?,
            explanation: row.get(3)?,
            application: row.get(4)?,
            illustration: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// The preparation a live point belongs to.
fn point_owner(conn: &Connection, point_id: &str) -> AppResult<String> {
    conn.query_row(
        "SELECT preparation_id FROM teaching_points WHERE id = ?1 AND deleted_at IS NULL",
        [point_id],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("teaching point", point_id))
}

/// A point named by a link or passage must be one of this preparation's.
fn check_point(conn: &Connection, prep_id: &str, point_id: Option<&str>) -> AppResult<()> {
    if let Some(point) = point_id {
        if point_owner(conn, point)? != prep_id {
            return Err(invalid(
                "teaching.otherPoint",
                "That point belongs to another teaching.",
            ));
        }
    }
    Ok(())
}

fn renumber(conn: &Connection, ids: &[String], now: &str) -> AppResult<()> {
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE teaching_points SET position = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, index as i64, now],
        )?;
    }
    Ok(())
}

pub fn create_point(
    conn: &Connection,
    input: &CreateTeachingPoint,
) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &input.preparation_id)?;
    let title = input.title.as_deref().unwrap_or("").trim().to_string();
    if title.chars().count() > validate::TITLE_MAX_CHARS {
        return Err(invalid(
            "teaching.tooLong",
            "This point's title is too long.",
        ));
    }
    let mut order: Vec<String> = points_for(conn, &prep.id)?
        .into_iter()
        .map(|p| p.id)
        .collect();
    let at = match input.after_point_id.as_deref().filter(|p| !p.is_empty()) {
        Some(after) => {
            check_point(conn, &prep.id, Some(after))?;
            order
                .iter()
                .position(|id| id == after)
                .map_or(order.len(), |i| i + 1)
        }
        None => order.len(),
    };
    let id = new_id();
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO teaching_points (id, preparation_id, position, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, prep.id, at as i64, title, now],
    )?;
    order.insert(at, id);
    renumber(&tx, &order, &now)?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

pub fn update_point(
    conn: &Connection,
    input: &UpdateTeachingPoint,
) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &point_owner(conn, &input.id)?)?;
    let current = points_for(conn, &prep.id)?
        .into_iter()
        .find(|p| p.id == input.id)
        .ok_or_else(|| AppError::not_found("teaching point", &input.id))?;
    let title = match &input.title {
        Some(t) => {
            let t = t.trim();
            if t.chars().count() > validate::TITLE_MAX_CHARS {
                return Err(invalid(
                    "teaching.tooLong",
                    "This point's title is too long.",
                ));
            }
            t.to_string()
        }
        None => current.title,
    };
    let field = |value: &Option<String>, current: String| match value {
        Some(v) => long_text(v),
        None => Ok(current),
    };
    let explanation = field(&input.explanation, current.explanation)?;
    let application = field(&input.application, current.application)?;
    let illustration = field(&input.illustration, current.illustration)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE teaching_points SET title = ?2, explanation = ?3, application = ?4,
             illustration = ?5, updated_at = ?6, revision = revision + 1
         WHERE id = ?1",
        params![input.id, title, explanation, application, illustration, now],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

/// Removes a point with what is attached to it (links, passages, kept
/// material); linked findings themselves stay in the study.
pub fn delete_point(conn: &Connection, point_id: &str) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &point_owner(conn, point_id)?)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE teaching_points SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![point_id, now],
    )?;
    for table in [
        "teaching_finding_links",
        "teaching_passages",
        "teaching_materials",
    ] {
        tx.execute(
            &format!(
                "UPDATE {table} SET deleted_at = ?2 WHERE point_id = ?1 AND deleted_at IS NULL"
            ),
            params![point_id, now],
        )?;
    }
    let order: Vec<String> = points_for(&tx, &prep.id)?
        .into_iter()
        .map(|p| p.id)
        .collect();
    renumber(&tx, &order, &now)?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

/// Puts the points in the given order; it must name exactly the live points.
pub fn reorder_points(conn: &Connection, input: &Reorder) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &input.parent_id)?;
    let current: Vec<String> = points_for(conn, &prep.id)?
        .into_iter()
        .map(|p| p.id)
        .collect();
    crate::db::check_same_members(&current, &input.ids, "points")?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    renumber(&tx, &input.ids, &now)?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

// ---------------------------------------------------------------------------
// Findings (linked, never copied)
// ---------------------------------------------------------------------------

fn findings_for(conn: &Connection, prep_id: &str) -> AppResult<Vec<TeachingFindingLink>> {
    // Links to findings deleted in the study, or under deleted points, are not shown.
    let mut stmt = conn.prepare(
        "SELECT l.id, l.point_id, l.finding_id FROM teaching_finding_links l
         JOIN findings f ON f.id = l.finding_id AND f.deleted_at IS NULL
         LEFT JOIN teaching_points p ON p.id = l.point_id
         WHERE l.preparation_id = ?1 AND l.deleted_at IS NULL
           AND (l.point_id IS NULL OR p.deleted_at IS NULL)
         ORDER BY l.position, l.created_at, l.rowid",
    )?;
    let rows: Vec<(String, Option<String>, String)> = stmt
        .query_map([prep_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    rows.into_iter()
        .map(|(id, point_id, finding_id)| {
            Ok(TeachingFindingLink {
                id,
                point_id,
                finding: findings::get(conn, &finding_id)?,
            })
        })
        .collect()
}

/// Uses one of the study's findings here. Linking the same finding to the
/// same place again changes nothing.
pub fn link_finding(
    conn: &Connection,
    input: &LinkTeachingFinding,
) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &input.preparation_id)?;
    let point_id = input.point_id.as_deref().filter(|p| !p.is_empty());
    check_point(conn, &prep.id, point_id)?;
    let finding = findings::get(conn, &input.finding_id)?;
    if finding.study_id != prep.study_id {
        return Err(invalid(
            "teaching.otherStudyFinding",
            "That finding belongs to another study.",
        ));
    }
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM teaching_finding_links
         WHERE preparation_id = ?1 AND COALESCE(point_id, '') = COALESCE(?2, '')
           AND finding_id = ?3 AND deleted_at IS NULL)",
        params![prep.id, point_id, finding.id],
        |r| r.get(0),
    )?;
    if exists {
        return get(conn, &prep.id);
    }
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM teaching_finding_links
         WHERE preparation_id = ?1 AND deleted_at IS NULL",
        [&prep.id],
        |r| r.get(0),
    )?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO teaching_finding_links (id, preparation_id, point_id, finding_id, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![new_id(), prep.id, point_id, finding.id, position, now],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

/// Stops using a finding here. The finding stays in the study as it is.
pub fn unlink_finding(conn: &Connection, link_id: &str) -> AppResult<TeachingPreparation> {
    let prep_id: String = conn
        .query_row(
            "SELECT preparation_id FROM teaching_finding_links WHERE id = ?1 AND deleted_at IS NULL",
            [link_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("teaching finding link", link_id))?;
    let prep = row(conn, &prep_id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE teaching_finding_links SET deleted_at = ?2 WHERE id = ?1",
        params![link_id, now],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

// ---------------------------------------------------------------------------
// Scripture
// ---------------------------------------------------------------------------

fn passages_for(conn: &Connection, prep_id: &str) -> AppResult<Vec<TeachingPassage>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.point_id, t.book, t.start_chapter, t.start_verse, t.end_chapter, t.end_verse
         FROM teaching_passages t LEFT JOIN teaching_points p ON p.id = t.point_id
         WHERE t.preparation_id = ?1 AND t.deleted_at IS NULL
           AND (t.point_id IS NULL OR p.deleted_at IS NULL)
         ORDER BY t.position, t.created_at, t.rowid",
    )?;
    type Raw = (
        String,
        Option<String>,
        String,
        u16,
        Option<u16>,
        Option<u16>,
        Option<u16>,
    );
    let rows: Vec<Raw> = stmt
        .query_map([prep_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    rows.into_iter()
        .map(|(id, point_id, book, sc, sv, ec, ev)| {
            let reference = reference_from_columns(&id, &book, (sc, sv), (ec, ev))?;
            Ok(TeachingPassage {
                id,
                point_id,
                reference: reference.to_dto(),
            })
        })
        .collect()
}

/// Names a passage in the teaching (or one point). The study's own passages
/// are not changed. The same passage in the same place is kept once.
pub fn add_passage(
    conn: &Connection,
    input: &AddTeachingPassage,
) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &input.preparation_id)?;
    let point_id = input.point_id.as_deref().filter(|p| !p.is_empty());
    check_point(conn, &prep.id, point_id)?;
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    let canonical = reference.canonical();
    if passages_for(conn, &prep.id)?
        .iter()
        .any(|p| p.point_id.as_deref() == point_id && p.reference.canonical == canonical)
    {
        return get(conn, &prep.id);
    }
    let (end_chapter, end_verse) = columns_for(&reference);
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM teaching_passages
         WHERE preparation_id = ?1 AND deleted_at IS NULL",
        [&prep.id],
        |r| r.get(0),
    )?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO teaching_passages (id, preparation_id, point_id, book, start_chapter,
             start_verse, end_chapter, end_verse, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            new_id(),
            prep.id,
            point_id,
            reference.book.code,
            reference.start.chapter,
            reference.start.verse,
            end_chapter,
            end_verse,
            position,
            now
        ],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

pub fn remove_passage(conn: &Connection, passage_id: &str) -> AppResult<TeachingPreparation> {
    let prep_id: String = conn
        .query_row(
            "SELECT preparation_id FROM teaching_passages WHERE id = ?1 AND deleted_at IS NULL",
            [passage_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("teaching passage", passage_id))?;
    let prep = row(conn, &prep_id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE teaching_passages SET deleted_at = ?2 WHERE id = ?1",
        params![passage_id, now],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

// ---------------------------------------------------------------------------
// Material kept from the assistant
// ---------------------------------------------------------------------------

fn materials_for(conn: &Connection, prep_id: &str) -> AppResult<Vec<TeachingMaterial>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.point_id, m.kind, m.standing, m.title, m.content, m.sources, m.image,
             m.assistant, m.created_at
         FROM teaching_materials m LEFT JOIN teaching_points p ON p.id = m.point_id
         WHERE m.preparation_id = ?1 AND m.deleted_at IS NULL
           AND (m.point_id IS NULL OR p.deleted_at IS NULL)
         ORDER BY m.position, m.created_at, m.rowid",
    )?;
    let rows = stmt.query_map([prep_id], |r| {
        let sources: Option<String> = r.get(6)?;
        let image: Option<String> = r.get(7)?;
        Ok(TeachingMaterial {
            id: r.get(0)?,
            point_id: r.get(1)?,
            kind: r.get(2)?,
            standing: r.get(3)?,
            title: r.get(4)?,
            content: r.get(5)?,
            sources: sources
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
            image: image.and_then(|s| serde_json::from_str(&s).ok()),
            assistant: r.get(8)?,
            created_at: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Only web addresses are kept as links (no `javascript:`, no local files).
pub(crate) fn is_web_address(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && !url.chars().any(char::is_whitespace)
        && url.len() <= SOURCE_TEXT_MAX
}

/// A generated image is saved by the core under a name it chose itself; a
/// kept item may only name such a file.
pub(crate) fn is_generated_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".png") else {
        return false;
    };
    !stem.is_empty() && stem.len() <= 64 && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn check_sources(sources: &[ExternalSource]) -> AppResult<()> {
    if sources.len() > SOURCES_MAX {
        return Err(invalid(
            "teaching.badMaterial",
            "This item has too many sources.",
        ));
    }
    for s in sources {
        if !is_web_address(&s.url)
            || [&s.title, &s.site, &s.excerpt]
                .iter()
                .any(|t| t.chars().count() > SOURCE_TEXT_MAX)
        {
            return Err(invalid(
                "teaching.badMaterial",
                "A source of this item cannot be kept.",
            ));
        }
    }
    Ok(())
}

fn check_image(image: &ImageInfo, standing: &str) -> AppResult<()> {
    let urls = [
        &image.url,
        &image.page_url,
        &image.thumb_url,
        &image.licence_url,
    ];
    if urls
        .iter()
        .any(|u| u.as_deref().is_some_and(|u| !is_web_address(u)))
    {
        return Err(invalid(
            "teaching.badMaterial",
            "This image's address cannot be kept.",
        ));
    }
    // A found image is kept only with where it is from and its licence.
    let blank = |v: &Option<String>| v.as_deref().is_none_or(|v| v.trim().is_empty());
    if standing == "found" && (blank(&image.page_url) || blank(&image.licence) || blank(&image.url))
    {
        return Err(invalid(
            "teaching.badMaterial",
            "An image is only kept with its source and licence.",
        ));
    }
    match (&image.file, standing) {
        (Some(file), "generated") if is_generated_file_name(file) => Ok(()),
        (Some(_), _) => Err(invalid(
            "teaching.badMaterial",
            "This image cannot be kept.",
        )),
        (None, "generated") => Err(invalid(
            "teaching.badMaterial",
            "This image cannot be kept.",
        )),
        (None, _) => Ok(()),
    }
}

/// Keeps something from the assistant, at the person's request, with its
/// standing. The rules keep the standing honest: a story is verified only
/// with two sources from different sites; images are found (with an
/// address) or generated (with a saved file); illustrations are invented.
pub fn keep_material(
    conn: &Connection,
    input: &KeepTeachingMaterial,
) -> AppResult<TeachingPreparation> {
    let prep = row(conn, &input.preparation_id)?;
    let point_id = input.point_id.as_deref().filter(|p| !p.is_empty());
    check_point(conn, &prep.id, point_id)?;
    let kind = input.kind.as_str();
    let standing = input.standing.as_str();
    if !MATERIAL_KINDS.contains(&kind) || !MATERIAL_STANDINGS.contains(&standing) {
        return Err(invalid("teaching.badMaterial", "This item cannot be kept."));
    }
    let allowed = match kind {
        "story" => matches!(standing, "verified" | "unverified"),
        "illustration" => standing == "hypothetical",
        "image" => matches!(standing, "found" | "generated"),
        _ => standing == "suggestion",
    };
    if !allowed {
        return Err(invalid("teaching.badMaterial", "This item cannot be kept."));
    }
    check_sources(&input.sources)?;
    if standing == "verified" {
        let mut sites: Vec<String> = input
            .sources
            .iter()
            .filter_map(|s| crate::assistant::research::site_of(&s.url))
            .collect();
        sites.sort();
        sites.dedup();
        if sites.len() < 2 {
            return Err(invalid(
                "teaching.notVerified",
                "A story is only kept as checked with two independent sources.",
            ));
        }
    }
    match (&input.image, kind) {
        (Some(image), "image") => check_image(image, standing)?,
        (None, "image") => {
            return Err(invalid(
                "teaching.badMaterial",
                "This image cannot be kept.",
            ))
        }
        (Some(_), _) => return Err(invalid("teaching.badMaterial", "This item cannot be kept.")),
        (None, _) => {}
    }
    let title = input.title.trim();
    let content = input.content.trim();
    if title.chars().count() > validate::TITLE_MAX_CHARS * 2 {
        return Err(invalid(
            "teaching.tooLong",
            "This item's title is too long.",
        ));
    }
    long_text(content)?;
    let assistant = input.assistant.as_deref().map(|a| {
        a.chars()
            .take(validate::TITLE_MAX_CHARS)
            .collect::<String>()
    });
    let sources = if input.sources.is_empty() {
        None
    } else {
        Some(
            serde_json::to_string(&input.sources)
                .map_err(|e| AppError::Unexpected(e.to_string()))?,
        )
    };
    let image = input
        .image
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| AppError::Unexpected(e.to_string()))?;
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM teaching_materials
         WHERE preparation_id = ?1 AND deleted_at IS NULL",
        [&prep.id],
        |r| r.get(0),
    )?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO teaching_materials (id, preparation_id, point_id, kind, standing, title,
             content, sources, image, assistant, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            new_id(),
            prep.id,
            point_id,
            kind,
            standing,
            title,
            content,
            sources,
            image,
            assistant,
            position,
            now
        ],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}

pub fn remove_material(conn: &Connection, material_id: &str) -> AppResult<TeachingPreparation> {
    let prep_id: String = conn
        .query_row(
            "SELECT preparation_id FROM teaching_materials WHERE id = ?1 AND deleted_at IS NULL",
            [material_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("teaching material", material_id))?;
    let prep = row(conn, &prep_id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE teaching_materials SET deleted_at = ?2 WHERE id = ?1",
        params![material_id, now],
    )?;
    touch(&tx, &prep, &now)?;
    tx.commit()?;
    get(conn, &prep.id)
}
