//! Bible documents (v0.23): the files a Bible was added from when they are
//! PDF, EPUB, Word, Markdown or text documents; their text for reading and
//! searching; and where each recognised verse came from.
//!
//! A document Bible is kept as its own documents, never as library sources:
//! it has no citations, marks or passage links of the library's. Removing
//! the Bible removes all of it (`ON DELETE CASCADE`), and the command layer
//! deletes the managed copies.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::bibles::{self, Shape, SourceRecord};
use crate::db::now;
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::import::{DocumentStage, StagedContent};
use crate::scripture::reference::verse_key;
use crate::scripture::{BibleTranslation, CommitImport};

/// A kept document file: its row id and its managed copy's name.
pub struct KeptFile {
    pub id: String,
    pub file_name: String,
}

/// Adds a Bible read from documents in one transaction: by its verses when
/// `as_verses` (they must be free of problems), otherwise as a document to
/// read. The documents and their text are kept either way.
#[allow(clippy::too_many_arguments)]
pub fn commit(
    conn: &Connection,
    id: &str,
    content: &StagedContent,
    stage: &DocumentStage,
    meta: &CommitImport,
    source: &SourceRecord,
    kept: &[KeptFile],
    as_verses: bool,
) -> AppResult<BibleTranslation> {
    if as_verses && (content.has_errors() || content.verse_count() == 0) {
        return Err(AppError::Import(UserMessage::new(
            "bibles.hasProblems",
            "This Bible has problems that must be resolved before it can be added.",
        )));
    }
    if kept.len() != stage.files.len() {
        return Err(AppError::Unexpected(
            "document files and records differ".into(),
        ));
    }
    let checked = bibles::check_details(conn, meta)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    let shape = if as_verses {
        Shape::Structured(content)
    } else {
        Shape::Document
    };
    bibles::insert_translation(&tx, id, &checked, meta, source, shape, &now)?;
    insert_documents(&tx, id, stage, kept, &now)?;
    if as_verses {
        bibles::insert_verses(&tx, id, content)?;
        insert_origins(&tx, id, stage, kept)?;
    }
    tx.commit()?;
    log::info!(
        "Bible added from {} document(s): {} ({})",
        kept.len(),
        checked.short_name,
        if as_verses {
            format!("{} verses", content.verse_count())
        } else {
            "read as a document".into()
        }
    );
    bibles::get(conn, id)
}

fn insert_documents(
    tx: &Connection,
    id: &str,
    stage: &DocumentStage,
    kept: &[KeptFile],
    now: &str,
) -> AppResult<()> {
    let mut add_document = tx.prepare(
        "INSERT INTO bible_documents
             (id, translation_id, position, format, file_name, original_file_name, sha256,
              size_bytes, extraction_status, page_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;
    let mut add_segment = tx.prepare(
        "INSERT INTO bible_document_segments (document_id, position, content, page_number, section_path)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (position, (file, record)) in stage.files.iter().zip(kept).enumerate() {
        add_document.execute(params![
            record.id,
            id,
            position as i64,
            file.format,
            record.file_name,
            file.file_name,
            file.hash,
            file.size as i64,
            file.extraction_status.as_str(),
            file.page_count,
            now
        ])?;
        for (n, segment) in file.segments.iter().enumerate() {
            add_segment.execute(params![
                record.id,
                n as i64,
                segment.text,
                segment.page_number,
                segment.section_path
            ])?;
        }
    }
    Ok(())
}

fn insert_origins(
    tx: &Connection,
    id: &str,
    stage: &DocumentStage,
    kept: &[KeptFile],
) -> AppResult<()> {
    let mut add = tx.prepare(
        "INSERT INTO bible_verse_origins
             (translation_id, verse_id, document_id, first_segment, last_segment, first_page, last_page)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for ((ordinal, chapter, verse), origin) in &stage.origins {
        let Some(document) = kept.get(usize::from(origin.start.document)) else {
            continue;
        };
        // A verse that runs into the next file keeps only where it starts.
        let same = origin.end.document == origin.start.document;
        add.execute(params![
            id,
            verse_key(*ordinal, *chapter, *verse),
            document.id,
            origin.start.segment,
            if same { origin.end.segment } else { None },
            origin.start.page,
            if same { origin.end.page } else { None }
        ])?;
    }
    Ok(())
}

/// Gives a Bible read as a document the verses found in it later (v0.23):
/// the documents and their text stay as they are.
pub fn add_verses(
    conn: &Connection,
    id: &str,
    content: &StagedContent,
    stage: &DocumentStage,
) -> AppResult<BibleTranslation> {
    let translation = bibles::get(conn, id)?;
    if translation.kind != "document" {
        return Err(AppError::InvalidInput(UserMessage::new(
            "bibles.alreadyVerses",
            "This Bible can already be read by book, chapter and verse.",
        )));
    }
    if content.has_errors() || content.verse_count() == 0 {
        return Err(AppError::Import(UserMessage::new(
            "bibles.hasProblems",
            "This Bible has problems that must be resolved before it can be added.",
        )));
    }
    let kept: Vec<KeptFile> = list(conn, id)?
        .into_iter()
        .map(|d| KeptFile {
            id: d.id,
            file_name: String::new(),
        })
        .collect();
    if kept.len() != stage.files.len() {
        return Err(AppError::Unexpected(
            "document files and records differ".into(),
        ));
    }
    let tx = conn.unchecked_transaction()?;
    bibles::insert_verses(&tx, id, content)?;
    insert_origins(&tx, id, stage, &kept)?;
    tx.execute(
        "UPDATE bible_translations
         SET kind = 'structured', import_status = 'ready', book_count = ?2, verse_count = ?3,
             updated_at = ?4, revision = revision + 1
         WHERE id = ?1",
        params![
            id,
            content.books.len() as i64,
            content.verse_count() as i64,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!(
        "Bible document given verses: {} ({} verses)",
        translation.short_name,
        content.verse_count()
    );
    bibles::get(conn, id)
}

/// One of a Bible's documents, as the reader sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibleDocument {
    pub id: String,
    pub position: i64,
    pub format: String,
    /// The file's name as the person had it.
    pub name: String,
    pub page_count: Option<i64>,
    pub extraction_status: String,
    /// Paragraphs of text kept (0 for scanned pages).
    pub segment_count: i64,
    /// How the original is shown: "pdf", "epub" or "docx" (its layout), or
    /// None (Markdown and text are shown as their text).
    pub view: Option<&'static str>,
}

pub fn list(conn: &Connection, translation_id: &str) -> AppResult<Vec<BibleDocument>> {
    let mut stmt = conn.prepare(
        "SELECT d.id, d.position, d.format, d.original_file_name, d.page_count, d.extraction_status,
                (SELECT COUNT(*) FROM bible_document_segments s WHERE s.document_id = d.id)
         FROM bible_documents d WHERE d.translation_id = ?1 ORDER BY d.position",
    )?;
    let rows = stmt.query_map([translation_id], |r| {
        let format: String = r.get(2)?;
        Ok(BibleDocument {
            id: r.get(0)?,
            position: r.get(1)?,
            view: crate::library::original::source_view_for(&format).map(|v| v.kind),
            format,
            name: r.get(3)?,
            page_count: r.get(4)?,
            extraction_status: r.get(5)?,
            segment_count: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Where a document's managed copy is: its Bible, its file name, its format.
pub struct DocumentRecord {
    pub translation_id: String,
    pub file_name: String,
    pub format: String,
    pub segment_count: i64,
}

pub fn record(conn: &Connection, document_id: &str) -> AppResult<DocumentRecord> {
    conn.query_row(
        "SELECT d.translation_id, d.file_name, d.format,
                (SELECT COUNT(*) FROM bible_document_segments s WHERE s.document_id = d.id)
         FROM bible_documents d WHERE d.id = ?1",
        [document_id],
        |r| {
            Ok(DocumentRecord {
                translation_id: r.get(0)?,
                file_name: r.get(1)?,
                format: r.get(2)?,
                segment_count: r.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("Bible document", document_id))
}

/// One paragraph of a document's text, with its place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSegment {
    pub position: i64,
    pub text: String,
    pub page_number: Option<i64>,
    pub section_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWindow {
    pub total: i64,
    pub offset: i64,
    pub segments: Vec<DocumentSegment>,
}

/// Most paragraphs one request returns.
const WINDOW_MAX: i64 = 400;

/// Paragraphs of a document from `offset` (or those of a page, `around_page`).
pub fn segments(
    conn: &Connection,
    document_id: &str,
    offset: i64,
    limit: i64,
    around_page: Option<i64>,
) -> AppResult<DocumentWindow> {
    let record = record(conn, document_id)?;
    let limit = limit.clamp(1, WINDOW_MAX);
    let offset = match around_page {
        Some(page) => conn
            .query_row(
                "SELECT MIN(position) FROM bible_document_segments
                 WHERE document_id = ?1 AND page_number >= ?2",
                params![document_id, page],
                |r| r.get::<_, Option<i64>>(0),
            )?
            .unwrap_or(0),
        None => offset.max(0),
    };
    let mut stmt = conn.prepare(
        "SELECT position, content, page_number, section_path FROM bible_document_segments
         WHERE document_id = ?1 AND position >= ?2 ORDER BY position LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![document_id, offset, limit], |r| {
        Ok(DocumentSegment {
            position: r.get(0)?,
            text: r.get(1)?,
            page_number: r.get(2)?,
            section_path: r.get(3)?,
        })
    })?;
    Ok(DocumentWindow {
        total: record.segment_count,
        offset,
        segments: rows.collect::<Result<_, _>>()?,
    })
}

/// A place in a document Bible's text where the words searched for occur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentHit {
    pub document_id: String,
    pub position: i64,
    pub page_number: Option<i64>,
    pub section_path: Option<String>,
    pub text: String,
}

const SEARCH_LIMIT: i64 = 200;

/// Searches the text of one document Bible.
pub fn search(conn: &Connection, translation_id: &str, query: &str) -> AppResult<Vec<DocumentHit>> {
    let Some(query) = crate::db::fts::query(query) else {
        return Err(AppError::InvalidInput(UserMessage::new(
            "search.empty",
            "Type a word or phrase to search for.",
        )));
    };
    let mut stmt = conn.prepare(
        "SELECT s.document_id, s.position, s.page_number, s.section_path, s.content
         FROM bible_document_search f
         JOIN bible_document_segments s ON s.seq = f.rowid
         JOIN bible_documents d ON d.id = s.document_id
         WHERE bible_document_search MATCH ?1 AND d.translation_id = ?2
         ORDER BY d.position, s.position
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![query, translation_id, SEARCH_LIMIT], |r| {
        Ok(DocumentHit {
            document_id: r.get(0)?,
            position: r.get(1)?,
            page_number: r.get(2)?,
            section_path: r.get(3)?,
            text: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Where a verse came from in its Bible's documents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseOrigin {
    pub document_id: String,
    pub document_name: String,
    pub first_segment: Option<i64>,
    pub last_segment: Option<i64>,
    pub first_page: Option<i64>,
    pub last_page: Option<i64>,
}

pub fn origin(
    conn: &Connection,
    translation_id: &str,
    verse_id: i64,
) -> AppResult<Option<VerseOrigin>> {
    Ok(conn
        .query_row(
            "SELECT o.document_id, d.original_file_name, o.first_segment, o.last_segment,
                    o.first_page, o.last_page
             FROM bible_verse_origins o JOIN bible_documents d ON d.id = o.document_id
             WHERE o.translation_id = ?1 AND o.verse_id = ?2",
            params![translation_id, verse_id],
            |r| {
                Ok(VerseOrigin {
                    document_id: r.get(0)?,
                    document_name: r.get(1)?,
                    first_segment: r.get(2)?,
                    last_segment: r.get(3)?,
                    first_page: r.get(4)?,
                    last_page: r.get(5)?,
                })
            },
        )
        .optional()?)
}
