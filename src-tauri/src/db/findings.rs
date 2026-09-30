//! Findings: structured results of study (observations, questions,
//! conclusions…), each optionally tied to a section, linked to canonical
//! passages, and tagged. Passages live in `passage_references`
//! (owner: finding), so they survive translation changes and removal.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::study_passages::{columns_for, reference_from_columns};
use crate::db::{new_id, now, sections, studies};
use crate::domain::{
    CreateFinding, Finding, FindingPassage, FindingType, LinkFindingPassage, Reorder,
    SetFindingTags, UpdateFinding,
};
use crate::error::{AppError, AppResult};
use crate::library::{AddFindingSource, FindingCitation};
use crate::scripture::reference::ScriptureRef;

const CONTENT_MAX_CHARS: usize = 50_000;
const TAG_MAX_CHARS: usize = 40;
const MAX_TAGS: usize = 20;

const COLUMNS: &str = "id, study_id, section_id, kind, content, sort_order, parent_id, \
                       created_at, updated_at, revision";

fn from_row(row: &Row) -> rusqlite::Result<Finding> {
    let kind: String = row.get(3)?;
    Ok(Finding {
        id: row.get(0)?,
        study_id: row.get(1)?,
        section_id: row.get(2)?,
        finding_type: FindingType::parse(&kind).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, e.into())
        })?,
        content: row.get(4)?,
        sort_order: row.get(5)?,
        parent_id: row.get(6)?,
        passages: Vec::new(),
        tags: Vec::new(),
        sources: Vec::new(),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        revision: row.get(9)?,
    })
}

fn passages_for(conn: &Connection, finding_id: &str) -> AppResult<Vec<FindingPassage>> {
    let mut stmt = conn.prepare(
        "SELECT id, book, start_chapter, start_verse, end_chapter, end_verse FROM passage_references
         WHERE finding_id = ?1 AND deleted_at IS NULL ORDER BY created_at, rowid",
    )?;
    let rows = stmt.query_map([finding_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, u16>(2)?,
            r.get::<_, Option<u16>>(3)?,
            r.get::<_, Option<u16>>(4)?,
            r.get::<_, Option<u16>>(5)?,
        ))
    })?;
    let mut passages = Vec::new();
    for row in rows {
        let (id, book, sc, sv, ec, ev) = row?;
        passages.push(FindingPassage {
            reference: reference_from_columns(&id, &book, (sc, sv), (ec, ev))?.to_dto(),
            id,
        });
    }
    Ok(passages)
}

fn tags_for(conn: &Connection, finding_id: &str) -> AppResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT tag FROM finding_tags WHERE finding_id = ?1 ORDER BY tag")?;
    let rows = stmt.query_map([finding_id], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn complete(conn: &Connection, mut finding: Finding) -> AppResult<Finding> {
    finding.passages = passages_for(conn, &finding.id)?;
    finding.tags = tags_for(conn, &finding.id)?;
    finding.sources = citations_for(conn, &finding.id)?;
    Ok(finding)
}

fn citations_for(conn: &Connection, finding_id: &str) -> AppResult<Vec<FindingCitation>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.finding_id, c.source_id, c.source_segment_id,
                COALESCE(s.title, c.cited_title, 'Removed source'), COALESCE(s.author, c.cited_author),
                c.locator, s.id IS NULL OR s.deleted_at IS NOT NULL
         FROM finding_sources c LEFT JOIN sources s ON s.id = c.source_id
         WHERE c.finding_id = ?1 AND c.deleted_at IS NULL
         ORDER BY c.created_at, c.rowid",
    )?;
    let rows = stmt.query_map([finding_id], |r| {
        Ok(FindingCitation {
            id: r.get(0)?,
            finding_id: r.get(1)?,
            source_id: r.get(2)?,
            segment_id: r.get(3)?,
            title: r.get(4)?,
            author: r.get(5)?,
            locator: r.get(6)?,
            removed: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Cites a library segment from a finding. Stores the source, the segment
/// and a snapshot of title, author and location — never the text itself.
/// Citing the same segment twice returns the finding unchanged.
pub fn add_source(conn: &Connection, input: &AddFindingSource) -> AppResult<Finding> {
    let finding = get(conn, &input.finding_id)?;
    let (source_id, segment) = crate::db::library::segment(conn, &input.segment_id)?;
    let source = crate::db::library::get(conn, &source_id)?;
    if finding
        .sources
        .iter()
        .any(|c| c.segment_id.as_deref() == Some(input.segment_id.as_str()))
    {
        return Ok(finding);
    }
    let now = now();
    conn.execute(
        "INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator,
             cited_title, cited_author, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            new_id(),
            finding.id,
            source.id,
            segment.id,
            segment.locator,
            source.title,
            source.author,
            now
        ],
    )?;
    studies::touch(conn, &finding.study_id, &now)?;
    get(conn, &finding.id)
}

/// Removes a citation (soft delete).
pub fn remove_source(conn: &Connection, citation_id: &str) -> AppResult<Finding> {
    let finding_id: String = conn
        .query_row(
            "SELECT finding_id FROM finding_sources WHERE id = ?1 AND deleted_at IS NULL",
            [citation_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("citation", citation_id))?;
    let now = now();
    conn.execute(
        "UPDATE finding_sources SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![citation_id, now],
    )?;
    let finding = get(conn, &finding_id)?;
    studies::touch(conn, &finding.study_id, &now)?;
    Ok(finding)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Finding> {
    let finding = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM findings WHERE id = ?1 AND deleted_at IS NULL"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("finding", id))?;
    complete(conn, finding)
}

/// A study's live findings in the user's order.
pub fn list(conn: &Connection, study_id: &str) -> AppResult<Vec<Finding>> {
    studies::get(conn, study_id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM findings WHERE study_id = ?1 AND deleted_at IS NULL
         ORDER BY sort_order, created_at, rowid"
    ))?;
    let rows: Vec<Finding> = stmt
        .query_map([study_id], from_row)?
        .collect::<Result<_, _>>()?;
    rows.into_iter().map(|f| complete(conn, f)).collect()
}

fn check_content(content: &str) -> AppResult<()> {
    if content.chars().count() > CONTENT_MAX_CHARS {
        return Err(AppError::InvalidInput(
            "This finding is too long to save.".into(),
        ));
    }
    Ok(())
}

fn check_section(conn: &Connection, study_id: &str, section_id: &str) -> AppResult<()> {
    let section = sections::get(conn, section_id)?;
    if section.study_id != study_id {
        return Err(AppError::InvalidInput(
            "That section belongs to another study.".into(),
        ));
    }
    Ok(())
}

/// Adds a finding at the end of the study's list, optionally linking one
/// passage straight away.
pub fn create(conn: &Connection, input: &CreateFinding) -> AppResult<Finding> {
    studies::get(conn, &input.study_id)?;
    let content = input.content.clone().unwrap_or_default();
    check_content(&content)?;
    let section_id = input.section_id.as_deref().filter(|s| !s.is_empty());
    if let Some(section) = section_id {
        check_section(conn, &input.study_id, section)?;
    }
    let passage = match input.passage.as_deref().filter(|p| !p.is_empty()) {
        Some(p) => Some(ScriptureRef::from_canonical(p)?),
        None => None,
    };
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM findings WHERE study_id = ?1 AND deleted_at IS NULL",
        [&input.study_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO findings (id, study_id, section_id, kind, content, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, input.study_id, section_id, input.finding_type.as_str(), content, position, now],
    )?;
    if let Some(reference) = passage {
        insert_passage(&tx, &id, &reference, &now)?;
    }
    studies::touch(&tx, &input.study_id, &now)?;
    tx.commit()?;
    get(conn, &id)
}

pub fn update(conn: &Connection, input: &UpdateFinding) -> AppResult<Finding> {
    let current = get(conn, &input.id)?;
    let content = input.content.clone().unwrap_or(current.content);
    check_content(&content)?;
    let section_id = match input.section_id.as_deref() {
        Some("") => None,
        Some(section) => {
            check_section(conn, &current.study_id, section)?;
            Some(section.to_string())
        }
        None => current.section_id,
    };
    let now = now();
    conn.execute(
        "UPDATE findings SET kind = ?2, content = ?3, section_id = ?4, updated_at = ?5,
             revision = revision + 1
         WHERE id = ?1",
        params![
            input.id,
            input.finding_type.unwrap_or(current.finding_type).as_str(),
            content,
            section_id,
            now
        ],
    )?;
    studies::touch(conn, &current.study_id, &now)?;
    get(conn, &input.id)
}

/// Soft delete, with the finding's passage links.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let finding = get(conn, id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE passage_references SET deleted_at = ?2, updated_at = ?2 WHERE finding_id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    tx.execute(
        "UPDATE findings SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, now],
    )?;
    studies::touch(&tx, &finding.study_id, &now)?;
    tx.commit()?;
    Ok(())
}

pub fn reorder(conn: &Connection, input: &Reorder) -> AppResult<Vec<Finding>> {
    let current: Vec<String> = list(conn, &input.parent_id)?
        .into_iter()
        .map(|f| f.id)
        .collect();
    crate::db::check_same_members(&current, &input.ids, "findings")?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    for (index, id) in input.ids.iter().enumerate() {
        tx.execute(
            "UPDATE findings SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, index as i64, now],
        )?;
    }
    studies::touch(&tx, &input.parent_id, &now)?;
    tx.commit()?;
    list(conn, &input.parent_id)
}

fn insert_passage(
    conn: &Connection,
    finding_id: &str,
    reference: &ScriptureRef,
    now: &str,
) -> AppResult<String> {
    let id = new_id();
    let (end_chapter, end_verse) = columns_for(reference);
    conn.execute(
        "INSERT INTO passage_references
             (id, finding_id, book, start_chapter, start_verse, end_chapter, end_verse, label,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            finding_id,
            reference.book.code,
            reference.start.chapter,
            reference.start.verse,
            end_chapter,
            end_verse,
            reference.display(),
            now
        ],
    )?;
    Ok(id)
}

/// Links a passage to a finding; linking the same passage again is a no-op.
pub fn link_passage(conn: &Connection, input: &LinkFindingPassage) -> AppResult<Finding> {
    let finding = get(conn, &input.finding_id)?;
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    if finding
        .passages
        .iter()
        .any(|p| p.reference.canonical == reference.canonical())
    {
        return Ok(finding);
    }
    let now = now();
    insert_passage(conn, &finding.id, &reference, &now)?;
    studies::touch(conn, &finding.study_id, &now)?;
    get(conn, &finding.id)
}

/// Removes one passage link (by its id) from a finding.
pub fn unlink_passage(conn: &Connection, passage_id: &str) -> AppResult<Finding> {
    let finding_id: String = conn
        .query_row(
            "SELECT finding_id FROM passage_references
             WHERE id = ?1 AND finding_id IS NOT NULL AND deleted_at IS NULL",
            [passage_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("passage", passage_id))?;
    let now = now();
    conn.execute(
        "UPDATE passage_references SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![passage_id, now],
    )?;
    let finding = get(conn, &finding_id)?;
    studies::touch(conn, &finding.study_id, &now)?;
    Ok(finding)
}

/// Normalises tags: trimmed, lower case, inner spaces collapsed, no "#".
pub fn normalise_tag(tag: &str) -> String {
    tag.trim()
        .trim_start_matches('#')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Replaces a finding's tags.
pub fn set_tags(conn: &Connection, input: &SetFindingTags) -> AppResult<Finding> {
    let finding = get(conn, &input.finding_id)?;
    let mut tags: Vec<String> = input
        .tags
        .iter()
        .map(|t| normalise_tag(t))
        .filter(|t| !t.is_empty())
        .collect();
    tags.sort();
    tags.dedup();
    if tags.len() > MAX_TAGS {
        return Err(AppError::InvalidInput(format!(
            "A finding can have at most {MAX_TAGS} tags."
        )));
    }
    if let Some(long) = tags.iter().find(|t| t.chars().count() > TAG_MAX_CHARS) {
        return Err(AppError::InvalidInput(format!(
            "The tag “{long}” is too long."
        )));
    }
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM finding_tags WHERE finding_id = ?1",
        [&finding.id],
    )?;
    for tag in &tags {
        tx.execute(
            "INSERT INTO finding_tags (finding_id, tag, created_at) VALUES (?1, ?2, ?3)",
            params![finding.id, tag, now],
        )?;
    }
    tx.execute(
        "UPDATE findings SET updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![finding.id, now],
    )?;
    studies::touch(&tx, &finding.study_id, &now)?;
    tx.commit()?;
    get(conn, &finding.id)
}

/// Copies all findings of one study into another (study duplication),
/// mapping sections to their copies.
pub(crate) fn copy_all(
    conn: &Connection,
    from_study: &str,
    to_study: &str,
    section_map: &[(String, String)],
) -> AppResult<()> {
    let sections: HashMap<&str, &str> = section_map
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    let now = now();
    for finding in list(conn, from_study)? {
        let id = new_id();
        let section = finding
            .section_id
            .as_deref()
            .and_then(|s| sections.get(s).copied());
        conn.execute(
            "INSERT INTO findings (id, study_id, section_id, kind, content, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, to_study, section, finding.finding_type.as_str(), finding.content, finding.sort_order, now],
        )?;
        for passage in &finding.passages {
            insert_passage(
                conn,
                &id,
                &ScriptureRef::from_canonical(&passage.reference.canonical)?,
                &now,
            )?;
        }
        for tag in &finding.tags {
            conn.execute(
                "INSERT INTO finding_tags (finding_id, tag, created_at) VALUES (?1, ?2, ?3)",
                params![id, tag, now],
            )?;
        }
        for citation in &finding.sources {
            conn.execute(
                "INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator,
                     cited_title, cited_author, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                params![
                    new_id(),
                    id,
                    citation.source_id,
                    citation.segment_id,
                    citation.locator,
                    citation.title,
                    citation.author,
                    now
                ],
            )?;
        }
    }
    Ok(())
}
