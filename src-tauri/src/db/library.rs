//! The personal library: sources, their managed file, segments with
//! provenance, Scripture links, search, and removal.
//!
//! Removal keeps the `sources` row as a tombstone (deleted_at set, title and
//! author kept) and deletes the text: segments (with their search entries
//! and Scripture links, via triggers and cascades) and the file row.
//! Citations in findings keep a snapshot of what they cited.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, workspaces};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::files::{category, safe_file_name};
use crate::library::import::StagedSource;
use crate::library::original;
use crate::library::{
    CommitSourceImport, DuplicateOf, GetSegments, LibraryHit, LibraryResults, LicenceStatus,
    ListSources, PassageMention, SearchLibrary, SegmentWindow, Source, SourceSegment,
    SourceSummary, SourceType,
};
use crate::scripture::reference::ScriptureRef;

const SEARCH_PAGE: i64 = 50;
const SEGMENT_PAGE: i64 = 150;
const MENTIONS_LIMIT: i64 = 200;

fn conversion(index: usize, e: AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, e.into())
}

const SOURCE_SELECT: &str = "
    SELECT s.id, s.title, s.subtitle, s.author, s.publisher, s.edition, s.publication_year,
           s.isbn, s.doi, s.language, s.source_type, s.licence_status, s.licence, s.notes,
           f.format, f.original_filename, f.extraction_status, f.page_count,
           (SELECT COUNT(*) FROM source_segments g WHERE g.source_id = s.id),
           (SELECT COUNT(*) FROM source_passages p WHERE p.source_id = s.id),
           s.content_hash, s.created_at, s.updated_at
    FROM sources s
    LEFT JOIN source_files f ON f.source_id = s.id AND f.is_primary = 1 AND f.deleted_at IS NULL";

fn source_from_row(row: &Row) -> rusqlite::Result<Source> {
    let source_type: String = row.get(10)?;
    let licence: String = row.get(11)?;
    Ok(Source {
        id: row.get(0)?,
        title: row.get(1)?,
        subtitle: row.get(2)?,
        author: row.get(3)?,
        publisher: row.get(4)?,
        edition: row.get(5)?,
        publication_year: row.get(6)?,
        isbn: row.get(7)?,
        doi: row.get(8)?,
        language: row.get(9)?,
        source_type: SourceType::parse(&source_type).map_err(|e| conversion(10, e))?,
        licence_status: LicenceStatus::parse(&licence).map_err(|e| conversion(11, e))?,
        licence: row.get(12)?,
        notes: row.get(13)?,
        format: row.get(14)?,
        original_filename: row.get(15)?,
        extraction_status: row.get(16)?,
        page_count: row.get(17)?,
        original_view: row
            .get::<_, Option<String>>(14)?
            .as_deref()
            .and_then(original::source_view_for),
        segment_count: row.get(18)?,
        passage_count: row.get(19)?,
        content_hash: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Source> {
    conn.query_row(
        &format!("{SOURCE_SELECT} WHERE s.id = ?1 AND s.deleted_at IS NULL"),
        [id],
        source_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("source", id))
}

/// Library list: live sources, newest first, lightweight rows.
pub fn list(conn: &Connection, filter: &ListSources) -> AppResult<Vec<SourceSummary>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.author, s.source_type, f.format, s.language, s.created_at
         FROM sources s
         LEFT JOIN source_files f ON f.source_id = s.id AND f.is_primary = 1 AND f.deleted_at IS NULL
         WHERE s.deleted_at IS NULL
           AND (?1 IS NULL OR s.source_type = ?1)
           AND (?2 IS NULL OR s.language = ?2)
         ORDER BY s.created_at DESC, s.title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(
        params![
            filter.source_type.map(SourceType::as_str),
            filter.language.as_deref().filter(|l| !l.is_empty())
        ],
        |r| {
            let source_type: String = r.get(3)?;
            Ok(SourceSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                author: r.get(2)?,
                source_type: SourceType::parse(&source_type).map_err(|e| conversion(3, e))?,
                format: r.get(4)?,
                language: r.get(5)?,
                created_at: r.get(6)?,
            })
        },
    )?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// A live source with exactly this content, if any.
pub fn find_duplicate(conn: &Connection, hash: &str) -> AppResult<Option<DuplicateOf>> {
    Ok(conn
        .query_row(
            "SELECT s.id, s.title FROM source_files f JOIN sources s ON s.id = f.source_id
             WHERE f.sha256 = ?1 AND f.deleted_at IS NULL AND s.deleted_at IS NULL LIMIT 1",
            [hash],
            |r| {
                Ok(DuplicateOf {
                    id: r.get(0)?,
                    title: r.get(1)?,
                })
            },
        )
        .optional()?)
}

/// Path of the managed copy, relative to the data folder's `sources/`.
pub fn managed_relative_path(source_id: &str, staged: &StagedSource) -> String {
    format!(
        "{}/{}/{}",
        category(staged.document.format),
        source_id,
        safe_file_name(&staged.file_name, &staged.extension)
    )
}

fn text(value: &Option<String>, max: usize, what: &str) -> AppResult<Option<String>> {
    validate::optional_text(value.as_deref(), max, what)
}

/// Writes a staged import in one transaction: source, file record, segments
/// (indexed by triggers) and Scripture links. The managed copy of the file
/// must already be in place at `relative_path`; on error the caller removes
/// it. Any failure leaves the database unchanged.
pub fn commit_import(
    conn: &Connection,
    source_id: &str,
    staged: &StagedSource,
    input: &CommitSourceImport,
    relative_path: &str,
) -> AppResult<Source> {
    if let Some(problem) = staged.problem() {
        return Err(AppError::Import(problem));
    }
    if !input.allow_duplicate {
        if let Some(existing) = find_duplicate(conn, &staged.hash)? {
            return Err(AppError::Conflict(
                UserMessage::new(
                    "library.duplicate",
                    format!(
                        "This file is already in your library as “{}”.",
                        existing.title
                    ),
                )
                .with("title", &existing.title),
            ));
        }
    }
    let title = validate::title(&input.title, "source")?;
    let author = text(&input.author, 300, "author")?;
    let workspace = workspaces::get_default(conn)?;
    let doc = &staged.document;
    let now = now();
    let file_id = new_id();

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, subtitle, author, publisher,
             edition, publication_year, isbn, doi, language, licence_status, licence, notes,
             content_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
        params![
            source_id,
            workspace.id,
            input
                .source_type
                .unwrap_or(SourceType::default_for(doc.format))
                .as_str(),
            title,
            text(&input.subtitle, 300, "subtitle")?,
            author,
            text(&input.publisher, 300, "publisher")?,
            text(&input.edition, 100, "edition")?,
            input.publication_year,
            text(&input.isbn, 40, "ISBN")?,
            text(&input.doi, 200, "DOI")?,
            text(&input.language, 40, "language")?,
            input
                .licence_status
                .unwrap_or(LicenceStatus::Private)
                .as_str(),
            text(&input.licence, DESCRIPTION_MAX_CHARS, "licence")?,
            text(&input.notes, DESCRIPTION_MAX_CHARS, "notes")?,
            staged.hash,
            now
        ],
    )?;
    tx.execute(
        "INSERT INTO source_files (id, source_id, relative_path, media_type, size_bytes, sha256,
             format, original_filename, original_path, is_primary, extraction_status, page_count,
             created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11, ?12, ?12)",
        params![
            file_id,
            source_id,
            relative_path,
            media_type(doc.format),
            staged.size as i64,
            staged.hash,
            doc.format,
            staged.file_name,
            staged.path.display().to_string(),
            doc.extraction_status.as_str(),
            doc.page_count,
            now
        ],
    )?;
    let mut segment_ids = Vec::with_capacity(doc.segments.len());
    {
        let mut insert = tx.prepare(
            "INSERT INTO source_segments (id, source_id, source_file_id, position, content,
                 page_number, page_label, chapter, heading, section_path, paragraph_index,
                 char_start, char_end, locator, extraction_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
        )?;
        for (position, segment) in doc.segments.iter().enumerate() {
            let id = new_id();
            insert.execute(params![
                id,
                source_id,
                file_id,
                position as i64,
                segment.text,
                segment.page_number,
                segment.page_label,
                segment.chapter,
                segment.heading,
                segment.section_path,
                segment.paragraph_index,
                segment.char_start,
                segment.char_end,
                segment.locator(),
                doc.extraction_status.as_str(),
                now
            ])?;
            segment_ids.push(id);
        }
        let mut link = tx.prepare(
            "INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key,
                 matched_text, start_offset, end_offset, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;
        for (segment_index, found) in &staged.references {
            let reference = ScriptureRef::from_canonical(&found.reference.canonical)?;
            link.execute(params![
                new_id(),
                source_id,
                segment_ids[*segment_index],
                reference.canonical(),
                reference.start_key(),
                reference.end_key(),
                found.text,
                found.start as i64,
                found.end as i64,
                now
            ])?;
        }
    }
    tx.commit()?;
    log::info!(
        "source added to library: {} segments, {} Scripture references",
        doc.segments.len(),
        staged.references.len()
    );
    get(conn, source_id)
}

fn media_type(format: &str) -> &'static str {
    match format {
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "markdown" => "text/markdown",
        _ => "text/plain",
    }
}

/// The managed file of a source, relative to `sources/`.
pub fn managed_file(conn: &Connection, source_id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT relative_path FROM source_files WHERE source_id = ?1 AND deleted_at IS NULL AND is_primary = 1",
            [source_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Removes a source's text and keeps a tombstone for citations. Returns the
/// managed file path (relative to `sources/`) for the caller to delete.
pub fn remove(conn: &Connection, id: &str) -> AppResult<Option<String>> {
    get(conn, id)?;
    let file = managed_file(conn, id)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    // Segments go (search entries by trigger, Scripture links by cascade,
    // citation segment links set to NULL by the foreign key).
    tx.execute("DELETE FROM source_segments WHERE source_id = ?1", [id])?;
    tx.execute(
        "UPDATE source_files SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE source_id = ?1",
        params![id, now],
    )?;
    tx.execute(
        "UPDATE sources SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, now],
    )?;
    tx.commit()?;
    log::info!("source removed from library (citations kept as records)");
    Ok(file)
}

fn segment_from_row(row: &Row) -> rusqlite::Result<SourceSegment> {
    Ok(SourceSegment {
        id: row.get(0)?,
        position: row.get(1)?,
        text: row.get(2)?,
        page_number: row.get(3)?,
        page_label: row.get(4)?,
        chapter: row.get(5)?,
        heading: row.get(6)?,
        section_path: row.get(7)?,
        paragraph_index: row.get(8)?,
        locator: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
    })
}

const SEGMENT_COLUMNS: &str =
    "id, position, content, page_number, page_label, chapter, heading, section_path, paragraph_index, locator";

/// A window of a source's segments, optionally centred on one segment, so
/// long books are never loaded whole.
pub fn segments(conn: &Connection, input: &GetSegments) -> AppResult<SegmentWindow> {
    get(conn, &input.source_id)?;
    let limit = input.limit.unwrap_or(SEGMENT_PAGE).clamp(1, 500);
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM source_segments WHERE source_id = ?1",
        [&input.source_id],
        |r| r.get(0),
    )?;
    let target = match &input.around_segment_id {
        Some(segment) => Some(
            conn.query_row(
                "SELECT position FROM source_segments WHERE id = ?1 AND source_id = ?2",
                params![segment, input.source_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| AppError::not_found("passage in this source", segment.as_str()))?,
        ),
        None => None,
    };
    // A physical page (PDF): its first segment, or the next one that has a
    // page, so the window opens where that page's text begins.
    let target = match (target, input.around_page) {
        (None, Some(page)) => conn
            .query_row(
                "SELECT position FROM source_segments
                 WHERE source_id = ?1 AND page_number >= ?2 ORDER BY position LIMIT 1",
                params![input.source_id, page],
                |r| r.get::<_, i64>(0),
            )
            .optional()?,
        (target, _) => target,
    };
    let offset = match target {
        Some(position) => (position - limit / 3).max(0),
        None => input.offset.unwrap_or(0).max(0),
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {SEGMENT_COLUMNS} FROM source_segments WHERE source_id = ?1
         ORDER BY position LIMIT ?2 OFFSET ?3"
    ))?;
    let segments = stmt
        .query_map(params![input.source_id, limit, offset], segment_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SegmentWindow {
        source_id: input.source_id.clone(),
        total,
        offset,
        segments,
        target_segment_id: input.around_segment_id.clone(),
    })
}

/// The managed file record of a live source: its relative path and format.
/// Refuses removed sources and sources without a live primary file.
pub fn original_record(conn: &Connection, source_id: &str) -> AppResult<(String, String)> {
    get(conn, source_id)?;
    conn.query_row(
        "SELECT relative_path, format FROM source_files
         WHERE source_id = ?1 AND is_primary = 1 AND deleted_at IS NULL",
        [source_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| {
        AppError::InvalidInput(UserMessage::new(
            "library.originalUnsupported",
            "This source has no original view.",
        ))
    })
}

pub fn segment(conn: &Connection, id: &str) -> AppResult<(String, SourceSegment)> {
    conn.query_row(
        &format!("SELECT {SEGMENT_COLUMNS}, source_id FROM source_segments WHERE id = ?1"),
        [id],
        |r| Ok((r.get::<_, String>(10)?, segment_from_row(r)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("passage in the library", id))
}

/// Full-text search over segment text, best matches first, paged.
pub fn search(conn: &Connection, input: &SearchLibrary) -> AppResult<LibraryResults> {
    let Some(query) = crate::db::fts::query(&input.query) else {
        return Err(AppError::InvalidInput(UserMessage::new(
            "search.empty",
            "Type a word or phrase to search for.",
        )));
    };
    let offset = input.offset.unwrap_or(0).max(0);
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.author, g.id, g.position, g.page_number, g.locator,
                snippet(library_search, 0, char(2), char(3), '…', 20)
         FROM library_search
         JOIN source_segments g ON g.seq = library_search.rowid
         JOIN sources s ON s.id = g.source_id AND s.deleted_at IS NULL
         WHERE library_search MATCH ?1
         ORDER BY rank
         LIMIT ?2 OFFSET ?3",
    )?;
    let mut hits = stmt
        .query_map(params![query, SEARCH_PAGE + 1, offset], |r| {
            Ok(LibraryHit {
                source_id: r.get(0)?,
                source_title: r.get(1)?,
                author: r.get(2)?,
                segment_id: r.get(3)?,
                position: r.get(4)?,
                page_number: r.get(5)?,
                locator: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                snippet: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = hits.len() as i64 > SEARCH_PAGE;
    hits.truncate(SEARCH_PAGE as usize);
    Ok(LibraryResults {
        hits,
        offset,
        has_more,
    })
}

/// Places in the library that mention a passage (overlapping ranges).
pub fn mentions(conn: &Connection, reference: &ScriptureRef) -> AppResult<Vec<PassageMention>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.author, g.id, g.locator, p.matched_text, p.passage
         FROM source_passages p
         JOIN source_segments g ON g.id = p.segment_id
         JOIN sources s ON s.id = p.source_id AND s.deleted_at IS NULL
         WHERE p.start_key <= ?2 AND p.end_key >= ?1
         ORDER BY s.title COLLATE NOCASE, g.position
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![reference.start_key(), reference.end_key(), MENTIONS_LIMIT],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    )?;
    let mut out = Vec::new();
    for row in rows {
        let (source_id, source_title, author, segment_id, locator, matched_text, passage) = row?;
        out.push(PassageMention {
            source_id,
            source_title,
            author,
            segment_id,
            locator: locator.unwrap_or_default(),
            matched_text,
            reference: ScriptureRef::from_canonical(&passage)?.to_dto(),
        });
    }
    Ok(out)
}

/// The Scripture passages a source mentions, in order (for the source view).
pub fn passages(conn: &Connection, source_id: &str) -> AppResult<Vec<PassageMention>> {
    let source = get(conn, source_id)?;
    let mut stmt = conn.prepare(
        "SELECT g.id, g.locator, p.matched_text, p.passage FROM source_passages p
         JOIN source_segments g ON g.id = p.segment_id
         WHERE p.source_id = ?1 ORDER BY g.position, p.start_offset",
    )?;
    let rows = stmt.query_map([source_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (segment_id, locator, matched_text, passage) = row?;
        out.push(PassageMention {
            source_id: source.id.clone(),
            source_title: source.title.clone(),
            author: source.author.clone(),
            segment_id,
            locator: locator.unwrap_or_default(),
            matched_text,
            reference: ScriptureRef::from_canonical(&passage)?.to_dto(),
        });
    }
    Ok(out)
}
