//! The personal library: sources, their managed file, segments with
//! provenance, Scripture links, search, and removal.
//!
//! Removal keeps the `sources` row as a tombstone (deleted_at set, title and
//! author kept) and deletes the text: segments (with their search entries
//! and Scripture links, via triggers and cascades) and the file row.
//! Citations in findings keep a snapshot of what they cited.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now, workspaces};
use crate::domain::validate::{self, DESCRIPTION_MAX_CHARS};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::contents::ContentsItem;
use crate::library::files::{category, safe_file_name};
use crate::library::find;
use crate::library::generated_contents;
use crate::library::import::StagedSource;
use crate::library::original;
use crate::library::passage_index::{self, PassageIndex};
use crate::library::relevance::{self, Context, KeyRange, Rank};
use crate::library::sections::{self, DerivedLink, LinkOrigin};
use crate::library::{
    CommitSourceImport, DuplicateOf, GetSegments, LibraryHit, LibraryResults, LicenceStatus,
    ListSources, PassageLocation, PassageMention, PassageSourceGroup, SearchLibrary,
    SegmentPassageLink, SegmentWindow, Source, SourceFind, SourceMatch, SourceReference,
    SourceSegment, SourceSummary, SourceType,
};
use crate::scripture::parser::DetectedReference;
use crate::scripture::reference::{verse_key, ScriptureRef};

const SEARCH_PAGE: i64 = 50;
const SEGMENT_PAGE: i64 = 150;
const MENTIONS_LIMIT: i64 = 200;
/// Places shown per source in the Sources pane; the rest are counted.
pub const LOCATIONS_PER_SOURCE: usize = 3;
/// Sources shown in the Sources pane for one passage.
pub const SOURCE_GROUP_LIMIT: usize = 30;

fn conversion(index: usize, e: AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, e.into())
}

const SOURCE_SELECT: &str = "
    SELECT s.id, s.title, s.subtitle, s.author, s.publisher, s.edition, s.publication_year,
           s.isbn, s.doi, s.language, s.source_type, s.licence_status, s.licence, s.notes,
           f.format, f.original_filename, f.extraction_status, f.page_count,
           (SELECT COUNT(*) FROM source_segments g WHERE g.source_id = s.id),
           (SELECT COUNT(*) FROM source_passages p WHERE p.source_id = s.id AND p.origin = 'explicit'),
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
    let language = text(&input.language, 40, "language")?;
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
            language,
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
    }
    // The passage index is made in the language the person finally chose, not
    // the one the preview assumed: reuse the preview's only if it is the same.
    let final_language = passage_index::language_of(language.as_deref(), "library import");
    // ...and for the kind finally chosen: a sermon or lecture may have a main passage.
    let kind = input
        .source_type
        .unwrap_or(SourceType::default_for(doc.format))
        .as_str();
    let rebuilt;
    let index = if staged.index.language == final_language
        && !crate::scripture::parser::MAIN_PASSAGE_KINDS.contains(&kind)
    {
        &staged.index
    } else {
        rebuilt = passage_index::build(
            doc.format,
            doc.segments.iter().map(|s| {
                (
                    s.text.as_str(),
                    s.section_path.as_deref(),
                    s.page_number.map(i64::from),
                )
            }),
            final_language,
            passage_index::SourceFacts {
                kind: Some(kind),
                title: &title,
            },
        );
        &rebuilt
    };
    insert_explicit(&tx, source_id, &segment_ids, &index.references, &now)?;
    insert_derived(&tx, source_id, &segment_ids, &index.sections, &now)?;
    tx.execute(
        "UPDATE sources SET passage_index_version = ?2 WHERE id = ?1",
        params![source_id, sections::INDEX_VERSION],
    )?;
    tx.commit()?;
    log::info!(
        "source added to library: {} segments, {} Scripture references, read as {}",
        doc.segments.len(),
        index.references.len(),
        index.language.code()
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

/// Places in the library whose own text mentions a passage (overlapping
/// ranges). Literal mentions only; see [`passage_sources`] for what the
/// Sources pane shows.
pub fn mentions(conn: &Connection, reference: &ScriptureRef) -> AppResult<Vec<PassageMention>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.author, g.id, g.locator, p.matched_text, p.passage
         FROM source_passages p
         JOIN source_segments g ON g.id = p.segment_id
         JOIN sources s ON s.id = p.source_id AND s.deleted_at IS NULL
         WHERE p.origin = 'explicit' AND p.start_key <= ?2 AND p.end_key >= ?1
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
         WHERE p.source_id = ?1 AND p.origin = 'explicit' ORDER BY g.position, p.start_offset",
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

/// The most references [`source_references`] returns for one source: far more
/// than any real book has, but a bound on what one call can carry.
pub const SOURCE_REFERENCES_LIMIT: i64 = 20_000;

/// The Scripture references written in a source's text, with where each is in
/// its segment, in reading order (v0.11). Only literal (explicit) links have a
/// place in the text; section and inherited links do not. Rows whose offsets
/// are missing or empty are left out rather than guessed. An unknown or removed
/// source gives an error, as the reader's other reads do.
pub fn source_references(conn: &Connection, source_id: &str) -> AppResult<Vec<SourceReference>> {
    get(conn, source_id)?;
    let mut stmt = conn.prepare(
        "SELECT g.position, p.start_offset, p.end_offset, p.passage FROM source_passages p
         INDEXED BY source_passages_source
         JOIN source_segments g ON g.id = p.segment_id
         WHERE p.source_id = ?1 AND p.origin = 'explicit'
           AND p.start_offset IS NOT NULL AND p.end_offset > p.start_offset
         ORDER BY g.position, p.start_offset, p.end_offset
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![source_id, SOURCE_REFERENCES_LIMIT], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (position, start, end, passage) = row?;
        let Ok(reference) = ScriptureRef::from_canonical(&passage) else {
            continue;
        };
        out.push(SourceReference {
            position,
            start,
            end,
            reference: reference.to_dto(),
        });
    }
    Ok(out)
}

/// Generated contents from a source's section headings (EPUB, Markdown and
/// other formats whose text is divided by headings; v0.13). An unknown or
/// removed source gives an error.
pub fn generated_contents(conn: &Connection, source_id: &str) -> AppResult<Vec<ContentsItem>> {
    get(conn, source_id)?;
    let mut stmt = conn.prepare(
        "SELECT position, section_path FROM source_segments
         WHERE source_id = ?1 ORDER BY position",
    )?;
    let segments = stmt
        .query_map(params![source_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<(i64, Option<String>)>, _>>()?;
    Ok(generated_contents::from_sections(&segments))
}

/// The most matches [`find_in_source`] returns, and the most it counts.
pub const FIND_MATCHES_LIMIT: usize = 2_000;
pub const FIND_COUNT_LIMIT: usize = 10_000;
/// The longest query [`find_in_source`] accepts, in characters.
pub const FIND_QUERY_CHARS: usize = 200;

/// Where `query` occurs in one source's text, segment by segment in reading
/// order (v0.13, "Find in this source"). Matching is [`crate::library::find`]'s:
/// case, accents and whitespace runs are ignored; nothing is guessed. A blank
/// query finds nothing. An unknown or removed source gives an error.
pub fn find_in_source(conn: &Connection, source_id: &str, query: &str) -> AppResult<SourceFind> {
    get(conn, source_id)?;
    let folded: Vec<char> = find::fold_query(query);
    let mut out = SourceFind {
        matches: Vec::new(),
        total: 0,
        truncated: false,
    };
    if folded.is_empty() || query.chars().count() > FIND_QUERY_CHARS {
        return Ok(out);
    }
    let mut stmt = conn.prepare(
        "SELECT position, page_number, content FROM source_segments
         WHERE source_id = ?1 ORDER BY position",
    )?;
    let mut rows = stmt.query(params![source_id])?;
    let mut counted = 0usize;
    while let Some(row) = rows.next()? {
        let position: i64 = row.get(0)?;
        let page_number: Option<i64> = row.get(1)?;
        let content: String = row.get(2)?;
        let left = FIND_COUNT_LIMIT - counted;
        // one more than may be counted, to know whether the bound was passed
        for (start, end) in find::occurrences(&content, &folded, left + 1) {
            if counted == FIND_COUNT_LIMIT {
                out.truncated = true;
                break;
            }
            counted += 1;
            if out.matches.len() < FIND_MATCHES_LIMIT {
                out.matches.push(SourceMatch {
                    position,
                    page_number,
                    start: start as i64,
                    end: end as i64,
                });
            }
        }
        if out.truncated {
            break;
        }
    }
    out.total = counted as i64;
    out.truncated |= counted > out.matches.len();
    Ok(out)
}

/// The most texts, and characters in each, that [`detect_in_source`] reads in
/// one call: a drawn page of a formatted source, comfortably.
pub const DETECT_TEXTS_LIMIT: usize = 5_000;
pub const DETECT_TEXT_CHARS: usize = 20_000;

/// Where drawn text comes from in a source (v0.13.1): the formatted document
/// covering segments `from..to`, or a PDF page.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawnScope {
    pub page: Option<i64>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

/// How the imported text resolved each bookless reference in a part of a source:
/// visible text → canonical passage, or `None` where the same text resolved to
/// different passages there (ambiguous, so it is not linked).
fn resolved_in_scope(
    conn: &Connection,
    source_id: &str,
    scope: DrawnScope,
) -> AppResult<HashMap<String, Option<String>>> {
    const SELECT: &str = "SELECT p.matched_text, p.passage FROM source_passages p
         JOIN source_segments g ON g.id = p.segment_id
         WHERE p.source_id = ?1 AND p.origin = 'explicit'";
    let (sql, bounds) = match scope {
        DrawnScope {
            page: Some(page), ..
        } => (format!("{SELECT} AND g.page_number = ?2"), vec![page]),
        DrawnScope {
            from: Some(from),
            to: Some(to),
            ..
        } => (
            format!("{SELECT} AND g.position >= ?2 AND g.position < ?3"),
            vec![from, to],
        ),
        _ => return Ok(HashMap::new()),
    };
    let mut out: HashMap<String, Option<String>> = HashMap::new();
    let mut stmt = conn.prepare(&sql)?;
    let mut values: Vec<&dyn rusqlite::ToSql> = vec![&source_id];
    values.extend(bounds.iter().map(|b| b as &dyn rusqlite::ToSql));
    let rows = stmt.query_map(values.as_slice(), |r| {
        Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (Some(text), passage) = row? else {
            continue;
        };
        out.entry(text)
            .and_modify(|seen| {
                if seen.as_deref() != Some(passage.as_str()) {
                    *seen = None;
                }
            })
            .or_insert(Some(passage));
    }
    Ok(out)
}

/// The Scripture references in pieces of a source's drawn text (the text nodes
/// of a formatted EPUB or Word page, or a PDF page's text), read in **the
/// source's language**, as at import (v0.11). One list per text, in the same
/// order; texts beyond the limits are read as empty. Deterministic: the same
/// parser as the index.
///
/// Bookless references (`15:4`, `v. 4`; v0.13.1) are never resolved again from
/// drawn text, whose structure is not known here: with a `scope`, such a
/// reference is linked only if the imported text of that document or page
/// resolved the same visible text to one passage, and to no other.
pub fn detect_in_source(
    conn: &Connection,
    source_id: &str,
    texts: &[String],
    scope: Option<DrawnScope>,
) -> AppResult<Vec<Vec<DetectedReference>>> {
    let source = get(conn, source_id)?;
    let language = passage_index::language_of(source.language.as_deref(), &source.title);
    let recogniser = crate::scripture::recognise::Recogniser::for_source(language);
    let parser = recogniser.primary();
    let resolved = match scope {
        Some(scope) => resolved_in_scope(conn, source_id, scope)?,
        None => HashMap::new(),
    };
    Ok(texts
        .iter()
        .enumerate()
        .map(|(i, text)| {
            if i >= DETECT_TEXTS_LIMIT
                || text.chars().count() > DETECT_TEXT_CHARS
                || !text.chars().any(|c| c.is_ascii_digit())
            {
                return Vec::new();
            }
            let mut found = recogniser.detect(text);
            if !resolved.is_empty() {
                let explicit: Vec<(usize, usize)> =
                    found.iter().map(|r| (r.start, r.end)).collect();
                for candidate in parser.bookless_candidates(text) {
                    let visible = &text[candidate.start..candidate.end];
                    let start = text[..candidate.start].encode_utf16().count();
                    let end = start + visible.encode_utf16().count();
                    if explicit.iter().any(|(s, e)| start < *e && *s < end) {
                        continue;
                    }
                    let Some(Some(canonical)) = resolved.get(visible) else {
                        continue;
                    };
                    let Ok(reference) = ScriptureRef::from_canonical(canonical) else {
                        continue;
                    };
                    found.push(DetectedReference {
                        text: visible.to_string(),
                        start,
                        end,
                        reference: reference.to_dto(),
                    });
                }
                found.sort_by_key(|r| (r.start, r.end));
            }
            found
        })
        .collect())
}

// --- passage-aware sources (v0.9) ---------------------------------------------

/// Stores the references found in segment text (`origin = 'explicit'`) for a
/// source whose segments, in reading order, have these ids.
fn insert_explicit(
    conn: &Connection,
    source_id: &str,
    segment_ids: &[String],
    references: &[(usize, DetectedReference)],
    now: &str,
) -> AppResult<()> {
    let mut insert = conn.prepare(
        "INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key,
             matched_text, start_offset, end_offset, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for (segment_index, found) in references {
        let reference = ScriptureRef::from_canonical(&found.reference.canonical)?;
        insert.execute(params![
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
    Ok(())
}

/// Stores derived (section, inherited) links for a source whose segments, in
/// reading order, have these ids.
fn insert_derived(
    conn: &Connection,
    source_id: &str,
    segment_ids: &[String],
    links: &[DerivedLink],
    now: &str,
) -> AppResult<()> {
    let mut insert = conn.prepare(
        "INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key,
             matched_text, start_offset, end_offset, created_at, origin, section_segment_id,
             section_heading)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9, ?10, ?11)",
    )?;
    for link in links {
        let reference = ScriptureRef::from_canonical(&link.canonical)?;
        insert.execute(params![
            new_id(),
            source_id,
            segment_ids[link.segment_index],
            reference.canonical(),
            reference.start_key(),
            reference.end_key(),
            link.matched_text,
            now,
            link.origin.as_str(),
            segment_ids[link.opener_index],
            link.heading,
        ])?;
    }
    Ok(())
}

/// Rebuilds a source's whole passage index (the references in its text and the
/// links derived from its headings) from what is stored: its segments and the
/// language it was filed under. The result is the same as at import for the
/// same source and language.
///
/// Replaces `explicit`, `section` and `inherited` links in one transaction and
/// touches nothing else: not `manual` links, segments, citations, files or the
/// source's own details. Returns the number of links stored.
pub fn reindex_passages(conn: &Connection, source_id: &str) -> AppResult<usize> {
    let (label, format, title, kind): (Option<String>, Option<String>, String, String) = conn
        .query_row(
            "SELECT s.language,
                (SELECT f.format FROM source_files f
                 WHERE f.source_id = s.id AND f.is_primary = 1 AND f.deleted_at IS NULL),
                s.title, s.source_type
         FROM sources s WHERE s.id = ?1",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
    let rows: Vec<(String, String, Option<String>, Option<i64>)> = conn
        .prepare(
            "SELECT id, content, section_path, page_number FROM source_segments
             WHERE source_id = ?1 ORDER BY position",
        )?
        .query_map([source_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<Result<_, _>>()?;
    let language = passage_index::language_of(label.as_deref(), "passage index rebuild");
    let index: PassageIndex = passage_index::build(
        format.as_deref().unwrap_or(""),
        rows.iter()
            .map(|(_, text, path, page)| (text.as_str(), path.as_deref(), *page)),
        language,
        passage_index::SourceFacts {
            kind: Some(&kind),
            title: &title,
        },
    );
    let ids: Vec<String> = rows.into_iter().map(|(id, _, _, _)| id).collect();
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM source_passages
         WHERE source_id = ?1 AND origin IN ('explicit', 'section', 'inherited')",
        [source_id],
    )?;
    insert_explicit(&tx, source_id, &ids, &index.references, &now)?;
    insert_derived(&tx, source_id, &ids, &index.sections, &now)?;
    tx.execute(
        "UPDATE sources SET passage_index_version = ?2 WHERE id = ?1",
        params![source_id, sections::INDEX_VERSION],
    )?;
    tx.commit()?;
    Ok(index.references.len() + index.sections.len())
}

/// What [`ensure_passage_index`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PassageIndexReport {
    pub rebuilt: usize,
    pub failed: usize,
}

/// Brings every source's passage index up to the current derivation: sources
/// that existed before v0.9, or were indexed by an older rule or in English
/// before language-aware detection, are rebuilt from what is stored, one
/// transaction each. A source that
/// fails is logged and left as it was (its literal links keep working) and is
/// tried again at the next start. Cheap when nothing is out of date.
pub fn ensure_passage_index(conn: &Connection) -> AppResult<PassageIndexReport> {
    let stale: Vec<String> = conn
        .prepare(
            "SELECT id FROM sources WHERE deleted_at IS NULL AND passage_index_version < ?1
             ORDER BY created_at, id",
        )?
        .query_map([sections::INDEX_VERSION], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut report = PassageIndexReport::default();
    for id in stale {
        match reindex_passages(conn, &id) {
            Ok(_) => report.rebuilt += 1,
            Err(error) => {
                report.failed += 1;
                log::warn!("passage links of source {id} could not be rebuilt: {error}");
            }
        }
    }
    if report.rebuilt + report.failed > 0 {
        log::info!(
            "passage links rebuilt for {} source(s), {} failed",
            report.rebuilt,
            report.failed
        );
    }
    Ok(report)
}

/// A source's places for the passage, one per segment, not yet consolidated.
struct Group {
    title: String,
    author: Option<String>,
    places: HashMap<String, Place>,
    about: bool,
}

/// Every place the relevance model accepts for the passage, grouped by source;
/// `only_source` limits it to one source. The single home of the relevance
/// rules for the Sources pane and for expanding a source's places.
fn collect_places(
    conn: &Connection,
    reference: &ScriptureRef,
    only_source: Option<&str>,
) -> AppResult<HashMap<String, Group>> {
    let active: KeyRange = (reference.start_key(), reference.end_key());
    let ordinal = reference.book.ordinal;
    // A link stays inside one book; its chapters are all that can match.
    let book_start = verse_key(ordinal, 0, 0);
    let window_start = verse_key(ordinal, reference.start.chapter, 0);
    let window_end = verse_key(ordinal, reference.end.chapter, 999);

    let mut groups: HashMap<String, Group> = HashMap::new();

    // The pane's query is left exactly as it was; one source adds an indexed filter.
    let one_source = if only_source.is_some() {
        " AND p.source_id = ?4"
    } else {
        ""
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT s.id, s.title, s.author, g.id, g.position, g.locator, p.origin, p.passage,
                p.start_key, p.end_key, p.matched_text, p.section_heading
         FROM source_passages p
         JOIN source_segments g ON g.id = p.segment_id
         JOIN sources s ON s.id = p.source_id AND s.deleted_at IS NULL
         WHERE p.origin IN ('explicit', 'section', 'manual')
           AND p.start_key >= ?1 AND p.start_key <= ?3 AND p.end_key >= ?2{one_source}"
    ))?;
    // The passage links of the section a paragraph lies in: its own section link
    // (an opening paragraph) or an inherited one, with where that section opens.
    let mut section_links = conn.prepare(
        "SELECT start_key, end_key, COALESCE(section_segment_id, segment_id)
         FROM source_passages INDEXED BY source_passages_segment
         WHERE segment_id = ?1 AND origin IN ('section', 'inherited')",
    )?;
    let mut rows = match only_source {
        Some(id) => stmt.query(params![book_start, window_start, window_end, id])?,
        None => stmt.query(params![book_start, window_start, window_end])?,
    };
    while let Some(row) = rows.next()? {
        let origin_text: String = row.get(6)?;
        let Some(origin) = LinkOrigin::parse(&origin_text) else {
            continue;
        };
        let segment_id: String = row.get(3)?;
        let link: KeyRange = (row.get(8)?, row.get(9)?);
        // No shared verse, no place: nothing is looked up for it.
        let Some(kind) = relevance::kind_of(active, link) else {
            continue;
        };
        let mut opener = segment_id.clone();
        let mut context = Context::Neutral;
        if origin == LinkOrigin::Explicit {
            let mut sections: Vec<KeyRange> = Vec::new();
            let found = section_links.query_map([&segment_id], |r| {
                Ok(((r.get(0)?, r.get(1)?), r.get::<_, String>(2)?))
            })?;
            for item in found {
                let (range, section_opener) = item?;
                sections.push(range);
                opener = section_opener;
            }
            context = relevance::section_context(active, &sections);
        }
        let Some(rank) = relevance::rank(active, link, origin, context) else {
            continue;
        };
        let source_id: String = row.get(0)?;
        let position: i64 = row.get(4)?;
        let passage: String = row.get(7)?;
        let group = groups.entry(source_id).or_insert_with(|| Group {
            title: row.get(1).unwrap_or_default(),
            author: row.get(2).unwrap_or_default(),
            places: HashMap::new(),
            about: false,
        });
        if rank.class <= 3 && matches!(origin, LinkOrigin::Section | LinkOrigin::Manual) {
            group.about = true;
        }
        let better = group
            .places
            .get(&segment_id)
            .is_none_or(|existing| rank < existing.rank);
        if better {
            group.places.insert(
                segment_id.clone(),
                Place {
                    rank,
                    position,
                    passage: passage.clone(),
                    opener,
                    location: PassageLocation {
                        segment_id,
                        locator: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                        origin,
                        match_kind: kind,
                        reference: ScriptureRef::from_canonical(&passage)?.to_dto(),
                        matched_text: row.get(10)?,
                        section_heading: row.get(11)?,
                    },
                },
            );
        }
    }
    Ok(groups)
}

/// The most places one source can list when expanded (a defensive bound).
pub const EXPANDED_LOCATIONS_LIMIT: usize = 200;

/// All the places in one source that fit the passage, in the order
/// [`passage_sources`] ranks them (so its first few are the ones it shows),
/// capped at [`EXPANDED_LOCATIONS_LIMIT`]. Same rules, same consolidation; a
/// source that does not fit (or does not exist) gives an empty list.
pub fn passage_source_locations(
    conn: &Connection,
    reference: &ScriptureRef,
    source_id: &str,
) -> AppResult<Vec<PassageLocation>> {
    let mut groups = collect_places(conn, reference, Some(source_id))?;
    let Some(group) = groups.remove(source_id) else {
        return Ok(Vec::new());
    };
    Ok(consolidate(group.places.into_values().collect())
        .into_iter()
        .take(EXPANDED_LOCATIONS_LIMIT)
        .map(|p| p.location)
        .collect())
}

/// The sources that fit a passage, best first, each with its best places.
///
/// Reads only indexed links, never source text, so turning a Bible page costs
/// one range lookup. Candidates are the literal mentions, section headings and
/// manual links that **share a verse** with the passage (a link that only shares
/// its chapter is not offered: the pane prefers precision to recall).
///
/// Whether a literal mention is *about* the passage or only cites it is read from
/// the headings around it: the mention's paragraph carries the passage links of
/// the section it lies in (its own section link, or an inherited one), found with
/// one indexed lookup per matching mention. A mention inside a section about the
/// passage is about it; inside a section headed with another passage it is a
/// cross-reference; with no passage heading it is neutral. See
/// [`relevance`] for the order this gives. Nothing stored is changed.
///
/// Places are ranked by [`relevance::rank`], one per segment, then consolidated
/// (see [`consolidate`]) so a section, the paragraph that opens it and repeated
/// mentions of the same passage inside it read as one place. Sources are ordered
/// by their best place; between equal best places, a source with a section or
/// manual link that is about the passage comes before one that only cites it;
/// then title, then id: a total order, so equal input gives equal output. How
/// many mentions a source has never raises its position.
pub fn passage_sources(
    conn: &Connection,
    reference: &ScriptureRef,
) -> AppResult<Vec<PassageSourceGroup>> {
    struct RankedGroup {
        best: Rank,
        /// A section or manual link that is about the passage (not merely broad).
        about: bool,
        title_key: String,
        group: PassageSourceGroup,
    }
    let groups = collect_places(conn, reference, None)?;

    let mut ranked: Vec<RankedGroup> = groups
        .into_iter()
        .map(|(source_id, group)| {
            let places = consolidate(group.places.into_values().collect());
            let best = places[0].rank;
            let more = places.len().saturating_sub(LOCATIONS_PER_SOURCE) as i64;
            let locations: Vec<PassageLocation> = places
                .into_iter()
                .take(LOCATIONS_PER_SOURCE)
                .map(|p| p.location)
                .collect();
            RankedGroup {
                best,
                about: group.about,
                title_key: group.title.to_lowercase(),
                group: PassageSourceGroup {
                    source_id,
                    source_title: group.title,
                    author: group.author,
                    locations,
                    more_locations: more,
                },
            }
        })
        .collect();
    ranked.sort_by(|a, b| {
        a.best
            .cmp(&b.best)
            .then(b.about.cmp(&a.about))
            .then(a.title_key.cmp(&b.title_key))
            .then(a.group.source_id.cmp(&b.group.source_id))
    });
    Ok(ranked
        .into_iter()
        .take(SOURCE_GROUP_LIMIT)
        .map(|r| r.group)
        .collect())
}

/// A candidate place in a source, before consolidation.
struct Place {
    rank: Rank,
    position: i64,
    passage: String,
    /// The segment the section it lies in opens on (itself outside any section).
    opener: String,
    location: PassageLocation,
}

/// One source's places, best first, without redundancy.
///
/// Places are ordered by rank (reading order, then id, break ties). A place is
/// then dropped when a better one in the *same local context* already shows it:
///
/// - the context is the section a paragraph lies in (where it opens), or the
///   segment itself outside any section;
/// - it is dropped when that earlier place is a section or manual link whose
///   fit is at least as good (the section already leads there), or when it
///   mentions the very same passage as the earlier place (the second "John 15:5"
///   in the same section adds no place).
///
/// A mention that fits the passage *better* than its section, or names a
/// different passage, stays: it is somewhere else worth going.
fn consolidate(mut places: Vec<Place>) -> Vec<Place> {
    places.sort_by(|a, b| {
        a.rank
            .cmp(&b.rank)
            .then(a.position.cmp(&b.position))
            .then(a.location.segment_id.cmp(&b.location.segment_id))
    });
    let mut kept: Vec<Place> = Vec::new();
    for place in places {
        let redundant = kept.iter().any(|k| {
            k.opener == place.opener
                && k.rank.fit <= place.rank.fit
                && (matches!(k.location.origin, LinkOrigin::Section | LinkOrigin::Manual)
                    || k.passage == place.passage)
        });
        if !redundant {
            kept.push(place);
        }
    }
    kept
}

/// Every passage a segment is linked to, and why (for the reader): what it
/// mentions, the section it opens, and the section it lies within.
pub fn segment_passage_links(
    conn: &Connection,
    segment_id: &str,
) -> AppResult<Vec<SegmentPassageLink>> {
    let mut stmt = conn.prepare(
        "SELECT origin, passage, matched_text, section_heading, section_segment_id
         FROM source_passages WHERE segment_id = ?1
         ORDER BY CASE origin WHEN 'manual' THEN 0 WHEN 'explicit' THEN 1 WHEN 'section' THEN 2
                              ELSE 3 END,
                  start_offset, start_key, end_key, id",
    )?;
    let rows = stmt.query_map([segment_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (origin, passage, matched_text, section_heading, section_segment_id) = row?;
        let Some(origin) = LinkOrigin::parse(&origin) else {
            continue;
        };
        out.push(SegmentPassageLink {
            origin,
            reference: ScriptureRef::from_canonical(&passage)?.to_dto(),
            matched_text,
            section_heading,
            section_segment_id,
        });
    }
    Ok(out)
}
