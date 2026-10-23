//! Findings: structured results of study (observations, questions,
//! conclusions…), each optionally tied to a section, linked to canonical
//! passages, and tagged. Passages live in `passage_references`
//! (owner: finding), so they survive translation changes and removal.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::source_annotations::{self, Cited};
use crate::db::study_passages::{columns_for, reference_from_columns};
use crate::db::{new_id, now, sections, studies};
use crate::domain::{
    CreateFinding, Finding, FindingPassage, FindingType, LinkFindingPassage, Reorder,
    SetFindingTags, UpdateFinding,
};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::annotations::CitationAnchor;
use crate::library::{
    AddFindingSource, CitationPlace, CitedPassage, CreateFindingFromSource, FindingCitation,
};
use crate::scripture::reference::ScriptureRef;

const CONTENT_MAX_CHARS: usize = 50_000;
const TAG_MAX_CHARS: usize = 40;
const MAX_TAGS: usize = 20;

const COLUMNS: &str = "id, study_id, section_id, kind, content, sort_order, parent_id, \
                       created_at, updated_at, revision, json_extract(data, '$.assistedBy')";

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
        assisted_by: row.get(10)?,
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
                c.locator, s.id IS NULL OR s.deleted_at IS NOT NULL,
                c.quote, c.cited_section, c.annotation_id, c.source_id IS NULL
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
            quote: r.get(8)?,
            section: r.get(9)?,
            annotation_id: r.get(10)?,
            unavailable: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// What one citation row holds: a snapshot of what was cited, and where.
struct NewCitation<'a> {
    source_id: &'a str,
    segment_id: Option<&'a str>,
    locator: Option<&'a str>,
    title: &'a str,
    author: Option<&'a str>,
    quote: Option<&'a str>,
    section: Option<&'a str>,
    anchor: Option<&'a CitationAnchor>,
    annotation_id: Option<&'a str>,
}

/// Whether the finding already cites exactly this: the same source, the same
/// place in it and the same words. The same words elsewhere (another place in
/// the paragraph or the source) are another citation. A whole paragraph cited
/// without words (the v0.4 "Add source") is the same as before: one per
/// paragraph.
fn already_cites(conn: &Connection, finding_id: &str, new: &NewCitation) -> AppResult<bool> {
    let mut stmt = conn.prepare(
        "SELECT source_segment_id, quote, anchor, annotation_id FROM finding_sources
         WHERE finding_id = ?1 AND source_id = ?2 AND deleted_at IS NULL",
    )?;
    let rows = stmt.query_map(params![finding_id, new.source_id], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (segment, quote, anchor, annotation) = row?;
        if quote.as_deref() != new.quote {
            continue;
        }
        let anchor = CitationAnchor::read(anchor.as_deref());
        let same = match (anchor.as_ref(), new.anchor) {
            // A whole paragraph, as before v0.15.
            (None, None) => segment.as_deref() == new.segment_id,
            (Some(old), Some(new_anchor)) => {
                let placed = new_anchor.start_segment_id.is_some() || new_anchor.page.is_some();
                old.same_place(new_anchor)
                    // Words that can no longer be placed are one citation only if from the same mark.
                    && (placed || annotation.as_deref() == new.annotation_id)
            }
            _ => false,
        };
        if same {
            return Ok(true);
        }
    }
    Ok(false)
}

fn insert_citation(
    conn: &Connection,
    finding_id: &str,
    new: &NewCitation,
    now: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator,
             cited_title, cited_author, quote, cited_section, anchor, annotation_id,
             created_at, updated_at, cited_source_id, cited_content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?3,
                 (SELECT content_hash FROM sources WHERE id = ?3))",
        params![
            new_id(),
            finding_id,
            new.source_id,
            new.segment_id,
            new.locator,
            new.title,
            new.author,
            new.quote,
            new.section,
            new.anchor.map(CitationAnchor::to_stored),
            new.annotation_id,
            now
        ],
    )?;
    Ok(())
}

/// Adds a citation of what was cited to a finding, unless it already cites
/// exactly that. The quote, location and title are snapshots: they stay as
/// they were when the source is removed or its text changes.
fn add_cited(conn: &Connection, finding: &Finding, cited: &Cited, now: &str) -> AppResult<bool> {
    let source = crate::db::library::get(conn, &cited.source_id)?;
    let new = NewCitation {
        source_id: &cited.source_id,
        segment_id: cited.segment_id.as_deref(),
        locator: cited.locator.as_deref().filter(|l| !l.is_empty()),
        title: &source.title,
        author: source.author.as_deref(),
        quote: cited.quote.as_deref(),
        section: cited.section_path.as_deref().filter(|s| !s.is_empty()),
        anchor: Some(&cited.anchor),
        annotation_id: cited.annotation_id.as_deref(),
    };
    if already_cites(conn, &finding.id, &new)? {
        return Ok(false);
    }
    insert_citation(conn, &finding.id, &new, now)?;
    Ok(true)
}

/// Cites a library source from a finding: a whole paragraph (as since v0.4:
/// the source, the segment and a snapshot of title, author and location), or
/// (v0.15) selected words, a place or a source mark, with the quote and where
/// it was. Citing exactly the same thing twice returns the finding unchanged.
pub fn add_source(conn: &Connection, input: &AddFindingSource) -> AppResult<Finding> {
    let finding = get(conn, &input.finding_id)?;
    let now = now();
    if let Some(segment_id) = input.segment_id.as_deref() {
        let (source_id, segment) = crate::db::library::segment(conn, segment_id)?;
        let source = crate::db::library::get(conn, &source_id)?;
        let new = NewCitation {
            source_id: &source.id,
            segment_id: Some(&segment.id),
            locator: Some(&segment.locator),
            title: &source.title,
            author: source.author.as_deref(),
            quote: None,
            section: segment.section_path.as_deref().filter(|s| !s.is_empty()),
            anchor: None,
            annotation_id: None,
        };
        if already_cites(conn, &finding.id, &new)? {
            return Ok(finding);
        }
        insert_citation(conn, &finding.id, &new, &now)?;
    } else {
        let cited = source_annotations::cite(conn, &input.cited)?;
        if !add_cited(conn, &finding, &cited, &now)? {
            return Ok(finding);
        }
    }
    studies::touch(conn, &finding.study_id, &now)?;
    get(conn, &finding.id)
}

/// A new finding made from a source ("Add to Study", v0.15): the person's
/// own words (or, when they wrote none, the cited words as the finding's
/// text) and a citation with the quote, in one transaction. Nothing else in
/// the study changes: no passages are added for references in the quote.
pub fn create_from_source(
    conn: &Connection,
    input: &CreateFindingFromSource,
) -> AppResult<Finding> {
    studies::get(conn, &input.study_id)?;
    let finding_type = FindingType::parse(&input.finding_type)?;
    let section_id = input.section_id.as_deref().filter(|s| !s.is_empty());
    if let Some(section) = section_id {
        check_section(conn, &input.study_id, section)?;
    }
    let cited = source_annotations::cite(conn, &input.cited)?;
    let written = input.content.as_deref().unwrap_or_default().trim();
    let content = if written.is_empty() {
        cited.quote.clone().ok_or_else(|| {
            AppError::InvalidInput(UserMessage::new(
                "findings.writeFirst",
                "Write something to add first.",
            ))
        })?
    } else {
        written.to_string()
    };
    check_content(&content)?;
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
        params![id, input.study_id, section_id, finding_type.as_str(), content, position, now],
    )?;
    let finding = Finding {
        id: id.clone(),
        study_id: input.study_id.clone(),
        section_id: section_id.map(str::to_string),
        finding_type,
        content,
        sort_order: position,
        parent_id: None,
        passages: Vec::new(),
        tags: Vec::new(),
        sources: Vec::new(),
        assisted_by: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        revision: 1,
    };
    add_cited(&tx, &finding, &cited, &now)?;
    studies::touch(&tx, &input.study_id, &now)?;
    tx.commit()?;
    get(conn, &id)
}

/// A note the person accepted from the assistant (v0.20): their (possibly
/// edited) words, the assistant's name, and a citation of each source
/// passage it rests on, each checked against the source's stored text now.
/// One transaction: the note is there with all its citations, or not at all.
pub fn create_assisted(
    conn: &Connection,
    input: &CreateFinding,
    assisted_by: &str,
    cited: &[CitedPassage],
) -> AppResult<Finding> {
    studies::get(conn, &input.study_id)?;
    let content = input
        .content
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    if content.is_empty() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "findings.writeFirst",
            "Write something to add first.",
        )));
    }
    check_content(&content)?;
    let section_id = input.section_id.as_deref().filter(|s| !s.is_empty());
    if let Some(section) = section_id {
        check_section(conn, &input.study_id, section)?;
    }
    let assisted_by = assisted_by.trim();
    if assisted_by.is_empty() || assisted_by.chars().count() > 200 {
        return Err(AppError::InvalidInput(UserMessage::new(
            "findings.assistantName",
            "The assistant's name is missing.",
        )));
    }
    let cited = cited
        .iter()
        .map(|c| source_annotations::cite(conn, c))
        .collect::<AppResult<Vec<_>>>()?;
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM findings WHERE study_id = ?1 AND deleted_at IS NULL",
        [&input.study_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    let now = now();
    let data = serde_json::json!({ "assistedBy": assisted_by }).to_string();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO findings (id, study_id, section_id, kind, content, data, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, input.study_id, section_id, input.finding_type.as_str(), content, data, position, now],
    )?;
    let finding = Finding {
        id: id.clone(),
        study_id: input.study_id.clone(),
        section_id: section_id.map(str::to_string),
        finding_type: input.finding_type,
        content,
        sort_order: position,
        parent_id: None,
        passages: Vec::new(),
        tags: Vec::new(),
        sources: Vec::new(),
        assisted_by: Some(assisted_by.to_string()),
        created_at: now.clone(),
        updated_at: now.clone(),
        revision: 1,
    };
    for c in &cited {
        add_cited(&tx, &finding, c, &now)?;
    }
    studies::touch(&tx, &input.study_id, &now)?;
    tx.commit()?;
    get(conn, &id)
}

/// Where a citation is in its source now, to open it there (v0.15); None
/// when the source has been removed.
pub fn locate_source(conn: &Connection, citation_id: &str) -> AppResult<Option<CitationPlace>> {
    let row = conn
        .query_row(
            "SELECT source_id, source_segment_id, quote, cited_section, anchor FROM finding_sources
             WHERE id = ?1 AND deleted_at IS NULL",
            [citation_id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("citation", citation_id))?;
    let (source_id, segment_id, quote, section, anchor) = row;
    // Not on this computer: there is nothing to open.
    let Some(source_id) = source_id else {
        return Ok(None);
    };
    let anchor = CitationAnchor::read(anchor.as_deref());
    source_annotations::locate_citation(
        conn,
        &source_id,
        segment_id.as_deref(),
        quote.as_deref(),
        section.as_deref(),
        anchor.as_ref(),
    )
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
        return Err(AppError::InvalidInput(UserMessage::new(
            "findings.tooLong",
            "This finding is too long to save.",
        )));
    }
    Ok(())
}

fn check_section(conn: &Connection, study_id: &str, section_id: &str) -> AppResult<()> {
    let section = sections::get(conn, section_id)?;
    if section.study_id != study_id {
        return Err(AppError::InvalidInput(UserMessage::new(
            "findings.otherStudySection",
            "That part belongs to another study.",
        )));
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
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "findings.tooManyTags",
                format!("A finding can have at most {MAX_TAGS} tags."),
            )
            .with("max", MAX_TAGS),
        ));
    }
    if let Some(long) = tags.iter().find(|t| t.chars().count() > TAG_MAX_CHARS) {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "findings.tagTooLong",
                format!("The tag “{long}” is too long."),
            )
            .with("tag", long),
        ));
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
            "INSERT INTO findings (id, study_id, section_id, kind, content, data, sort_order, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, data, ?6, ?7, ?7 FROM findings WHERE id = ?8",
            params![id, to_study, section, finding.finding_type.as_str(), finding.content, finding.sort_order, now, finding.id],
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
        // Every citation, with its quote, place and snapshots, as it is.
        let citation_ids: Vec<String> = conn
            .prepare(
                "SELECT id FROM finding_sources WHERE finding_id = ?1 AND deleted_at IS NULL
                 ORDER BY created_at, rowid",
            )?
            .query_map([&finding.id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        for citation in citation_ids {
            conn.execute(
                "INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator,
                     cited_title, cited_author, quote, cited_section, anchor, annotation_id,
                     created_at, updated_at, cited_source_id, cited_content_hash)
                 SELECT ?1, ?2, source_id, source_segment_id, locator, cited_title, cited_author,
                        quote, cited_section, anchor, annotation_id, ?3, ?3, cited_source_id,
                        cited_content_hash
                 FROM finding_sources WHERE id = ?4",
                params![new_id(), id, now, citation],
            )?;
        }
    }
    Ok(())
}
