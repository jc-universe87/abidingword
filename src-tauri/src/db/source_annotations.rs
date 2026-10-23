//! Source annotations (v0.14): highlights, notes and bookmarks in a library
//! source, stored apart from Scripture annotations. The anchor model and the
//! text arithmetic are in `library::annotations`; this module reads and
//! writes them and finds them again when the stored text changes.
//!
//! Finding an annotation again (`resolve_source`) is deterministic and never
//! guesses. In order:
//!
//! 1. its segments still hold its quote at its offsets — exact;
//! 2. the quote occurs once in the segments it was on (or, if several times,
//!    exactly one occurrence has the stored context);
//! 3. the quote with its context occurs once within a few paragraphs of where
//!    it was;
//! 4. … once on the same page or in the same section;
//! 5. … once in the whole source;
//! 6. a place (bookmark, note on a paragraph) whose paragraph has gone: the
//!    first paragraph of its page or section;
//! 7. otherwise it is unresolved: kept and listed with its words, never drawn.
//!
//! An ambiguous step makes it unresolved at once: a wider step could only be
//! as ambiguous. Passage-index rebuilds never touch any of this.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{library, new_id, now, workspaces};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::annotations::{
    absorb, pack, pick, remainders, unpack, AnchorState, AnnotationPoint, CitationAnchor,
    CreateSourceAnnotation, Line, LinePoint, MarkedSource, Pick, PlaceDetails, SourceAnnotation,
    SourceMark, SourceMarksPage, SourceMarksQuery, Span, StoredSegment, TextPoint,
    UpdateSourceAnnotation, SOURCE_ANNOTATION_KINDS,
};
use crate::library::{CitationPlace, CitationWords, CitedPassage};
use crate::scripture::annotation_data::{validate_color, DEFAULT_HIGHLIGHT_COLOR};

const COLUMNS: &str = "id, source_id, kind, color, content, start_segment_id, start_offset,
     end_segment_id, end_offset, quote, prefix, suffix, position, page_number, locator,
     section_path, anchor, anchor_state, created_at, updated_at, revision";

const CONTENT_MAX_CHARS: usize = 20_000;
const QUOTE_MAX_CHARS: usize = 20_000;
/// Paragraphs on either side searched in step 3.
const NEARBY: usize = 20;

#[derive(Debug, Clone)]
struct Raw {
    id: String,
    source_id: String,
    kind: String,
    color: Option<String>,
    content: String,
    start_segment_id: Option<String>,
    start_offset: Option<u32>,
    end_segment_id: Option<String>,
    end_offset: Option<u32>,
    quote: Option<String>,
    prefix: Option<String>,
    suffix: Option<String>,
    position: Option<i64>,
    page_number: Option<i64>,
    locator: Option<String>,
    section_path: Option<String>,
    anchor: Option<String>,
    state: AnchorState,
    created_at: String,
    updated_at: String,
    revision: i64,
}

fn from_row(row: &Row) -> rusqlite::Result<Raw> {
    Ok(Raw {
        id: row.get(0)?,
        source_id: row.get(1)?,
        kind: row.get(2)?,
        color: row.get(3)?,
        content: row.get(4)?,
        start_segment_id: row.get(5)?,
        start_offset: row.get(6)?,
        end_segment_id: row.get(7)?,
        end_offset: row.get(8)?,
        quote: row.get(9)?,
        prefix: row.get(10)?,
        suffix: row.get(11)?,
        position: row.get(12)?,
        page_number: row.get(13)?,
        locator: row.get(14)?,
        section_path: row.get(15)?,
        anchor: row.get(16)?,
        state: AnchorState::parse(&row.get::<_, String>(17)?),
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        revision: row.get(20)?,
    })
}

fn invalid(key: &'static str, message: &str) -> AppError {
    AppError::InvalidInput(UserMessage::new(key, message))
}

/// A segment's place in its source: (source id, position).
fn segment_place(conn: &Connection, id: &str) -> AppResult<Option<(String, i64)>> {
    Ok(conn
        .prepare_cached(
            "SELECT source_id, position FROM source_segments WHERE id = ?1 AND deleted_at IS NULL",
        )?
        .query_row([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

fn stored_segment(row: &Row) -> rusqlite::Result<StoredSegment> {
    Ok(StoredSegment {
        id: row.get(0)?,
        position: row.get(1)?,
        text: row.get(2)?,
        page_number: row.get(3)?,
        section_path: row.get(4)?,
        locator: row.get(5)?,
    })
}

const SEGMENT_SELECT: &str =
    "SELECT id, position, content, page_number, section_path, locator FROM source_segments";

/// A source's segments with positions in `from..=to`, in reading order.
fn segments_between(
    conn: &Connection,
    source_id: &str,
    from: i64,
    to: i64,
) -> AppResult<Vec<StoredSegment>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{SEGMENT_SELECT} WHERE source_id = ?1 AND deleted_at IS NULL AND position BETWEEN ?2 AND ?3
         ORDER BY position, seq"
    ))?;
    let rows = stmt.query_map(params![source_id, from, to], stored_segment)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn all_segments(conn: &Connection, source_id: &str) -> AppResult<Vec<StoredSegment>> {
    segments_between(conn, source_id, i64::MIN, i64::MAX)
}

/// An anchor on words, built from the stored text.
#[derive(Debug, Clone, PartialEq)]
struct Built {
    start_segment_id: String,
    start_offset: u32,
    end_segment_id: String,
    end_offset: u32,
    quote: String,
    prefix: String,
    suffix: String,
    position: i64,
    page_number: Option<i64>,
    locator: Option<String>,
    section_path: Option<String>,
    span: Span,
}

/// Builds the anchor for a byte range of `line`, trimmed of white space at
/// both ends; `None` if nothing visible is left.
fn build(line: &Line, from: usize, to: usize) -> Option<Built> {
    let (start, end) = line.trimmed(from, to)?;
    let (from, to) = (line.byte(start)?, line.byte(end)?);
    let (prefix, suffix) = line.context(from, to);
    let first = &line.segments[start.index];
    let last = &line.segments[end.index];
    Some(Built {
        start_segment_id: first.id.clone(),
        start_offset: start.offset,
        end_segment_id: last.id.clone(),
        end_offset: end.offset,
        quote: line.text[from..to].to_string(),
        prefix,
        suffix,
        position: first.position,
        page_number: first.page_number,
        locator: first.locator.clone(),
        section_path: first.section_path.clone(),
        span: Span {
            start: pack(first.position, start.offset),
            end: pack(last.position, end.offset),
        },
    })
}

/// The anchor for a span of a source (a remainder of a cut highlight).
fn build_span(conn: &Connection, source_id: &str, span: Span) -> AppResult<Option<Built>> {
    let (from_position, from_offset) = unpack(span.start);
    let (to_position, to_offset) = unpack(span.end);
    let segments = segments_between(conn, source_id, from_position - 1, to_position + 1)?;
    let line = Line::new(&segments);
    let index = |position: i64| segments.iter().position(|s| s.position == position);
    let (Some(first), Some(last)) = (index(from_position), index(to_position)) else {
        return Ok(None);
    };
    let from = line.byte(LinePoint {
        index: first,
        offset: from_offset,
    });
    let to = line.byte(LinePoint {
        index: last,
        offset: to_offset,
    });
    Ok(match (from, to) {
        (Some(from), Some(to)) if from < to => build(&line, from, to),
        _ => None,
    })
}

/// The current position of each segment id given.
fn positions(conn: &Connection, ids: &[&str]) -> AppResult<HashMap<String, i64>> {
    let mut found = HashMap::new();
    let mut stmt = conn.prepare_cached(
        "SELECT position FROM source_segments WHERE id = ?1 AND deleted_at IS NULL",
    )?;
    for id in ids {
        if found.contains_key(*id) {
            continue;
        }
        if let Some(position) = stmt.query_row([id], |r| r.get(0)).optional()? {
            found.insert((*id).to_string(), position);
        }
    }
    Ok(found)
}

fn to_annotation(conn: &Connection, raw: Raw) -> AppResult<SourceAnnotation> {
    let details = PlaceDetails::read(raw.anchor.as_deref());
    let ids: Vec<&str> = [&raw.start_segment_id, &raw.end_segment_id]
        .into_iter()
        .flatten()
        .map(String::as_str)
        .collect();
    let at = positions(conn, &ids)?;
    let point = |id: &Option<String>, offset: Option<u32>| {
        let id = id.as_ref()?;
        Some(AnnotationPoint {
            segment_id: id.clone(),
            position: *at.get(id)?,
            offset,
        })
    };
    let resolved = raw.state != AnchorState::Unresolved;
    let start = resolved
        .then(|| point(&raw.start_segment_id, raw.start_offset))
        .flatten();
    let end = (resolved && raw.quote.is_some())
        .then(|| point(&raw.end_segment_id, raw.end_offset))
        .flatten();
    Ok(SourceAnnotation {
        id: raw.id,
        source_id: raw.source_id,
        color: (raw.kind == "highlight").then(|| {
            raw.color
                .clone()
                .unwrap_or_else(|| DEFAULT_HIGHLIGHT_COLOR.to_string())
        }),
        kind: raw.kind,
        content: raw.content,
        quote: raw.quote,
        position: start.as_ref().map(|p| p.position).or(raw.position),
        start,
        end,
        page_number: details.page.or(raw.page_number),
        fraction: details.fraction,
        locator: raw.locator,
        section_path: raw.section_path,
        state: raw.state,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        revision: raw.revision,
    })
}

fn get_raw(conn: &Connection, id: &str) -> AppResult<Raw> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM source_annotations WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("mark", id))
}

pub fn get(conn: &Connection, id: &str) -> AppResult<SourceAnnotation> {
    let raw = get_raw(conn, id)?;
    to_annotation(conn, raw)
}

fn live_rows(conn: &Connection, source_id: &str) -> AppResult<Vec<Raw>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM source_annotations
         WHERE source_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at, rowid"
    ))?;
    let rows = stmt.query_map([source_id], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// A source's live annotations in reading order (unresolved ones last),
/// each found again in the stored text first.
pub fn list_for_source(conn: &Connection, source_id: &str) -> AppResult<Vec<SourceAnnotation>> {
    library::get(conn, source_id)?;
    resolve_source(conn, source_id)?;
    let mut marks = live_rows(conn, source_id)?
        .into_iter()
        .map(|raw| to_annotation(conn, raw))
        .collect::<AppResult<Vec<_>>>()?;
    marks.sort_by_key(|m| {
        (
            m.state == AnchorState::Unresolved,
            m.start
                .as_ref()
                .map_or(m.position.unwrap_or(i64::MAX), |p| p.position),
            m.start.as_ref().and_then(|p| p.offset).unwrap_or(0),
            m.page_number.unwrap_or(0),
            (m.fraction.unwrap_or(0.0) * 1_000_000.0) as i64,
        )
    });
    Ok(marks)
}

const MARKS_PAGE: i64 = 30;
const MARKS_PAGE_MAX: i64 = 100;

/// A page of the person's marks in library sources, for the Marks view: by
/// source title, then reading order (unresolved last in each source). Live
/// marks of live sources only. Filters are optional: kind, source, highlight
/// colour, and words in a note (case-insensitive in any script, read while
/// walking the ordered rows, as the Bible's marks are). Marks are shown as
/// last found; they are found again when their source is opened.
pub fn marks(conn: &Connection, query: &SourceMarksQuery) -> AppResult<SourceMarksPage> {
    let mut clauses = vec!["a.deleted_at IS NULL AND s.deleted_at IS NULL".to_string()];
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    let needle = query
        .query
        .as_deref()
        .map(|q| q.trim().to_lowercase())
        .filter(|q| !q.is_empty());
    let kind = if needle.is_some() {
        Some("note")
    } else {
        query.kind.as_deref()
    };
    if let Some(kind) = kind {
        check_kind(kind)?;
        clauses.push("a.kind = ?".into());
        values.push(kind.to_string().into());
    }
    if let Some(source) = query.source_id.as_deref() {
        clauses.push("a.source_id = ?".into());
        values.push(source.to_string().into());
    }
    if let Some(color) = query.color.as_deref() {
        validate_color(color)?;
        clauses.push(format!(
            "a.kind = 'highlight' AND COALESCE(a.color, '{DEFAULT_HIGHLIGHT_COLOR}') = ?"
        ));
        values.push(color.to_string().into());
    }
    let limit = query.limit.unwrap_or(MARKS_PAGE).clamp(1, MARKS_PAGE_MAX) as usize;
    let offset = query.offset.unwrap_or(0).max(0) as usize;
    let columns = COLUMNS
        .split(',')
        .map(|c| format!("a.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let mut stmt = conn.prepare(&format!(
        "SELECT {columns}, s.title, s.author FROM source_annotations a
         JOIN sources s ON s.id = a.source_id
         WHERE {}
         ORDER BY s.title COLLATE NOCASE, a.source_id, a.anchor_state = 'unresolved',
                  a.position, a.start_offset, a.created_at, a.rowid",
        clauses.join(" AND ")
    ))?;
    let mut rows = stmt.query(rusqlite::params_from_iter(values))?;
    let mut page: Vec<(Raw, String, Option<String>)> = Vec::with_capacity(limit);
    let mut skipped = 0usize;
    let mut has_more = false;
    while let Some(row) = rows.next()? {
        let raw = from_row(row)?;
        if let Some(needle) = &needle {
            if !raw.content.to_lowercase().contains(needle.as_str()) {
                continue;
            }
        }
        if skipped < offset {
            skipped += 1;
        } else if page.len() == limit {
            has_more = true;
            break;
        } else {
            page.push((raw, row.get(21)?, row.get(22)?));
        }
    }
    drop(rows);
    let marks = page
        .into_iter()
        .map(|(raw, source_title, source_author)| {
            Ok(SourceMark {
                annotation: to_annotation(conn, raw)?,
                source_title,
                source_author,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(SourceMarksPage {
        marks,
        offset: offset as i64,
        has_more,
    })
}

/// The live sources that have live marks, by title, with how many.
pub fn marked_sources(conn: &Connection) -> AppResult<Vec<MarkedSource>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, COUNT(*) FROM source_annotations a
         JOIN sources s ON s.id = a.source_id
         WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL
         GROUP BY s.id ORDER BY s.title COLLATE NOCASE, s.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MarkedSource {
            source_id: r.get(0)?,
            title: r.get(1)?,
            count: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// How many live annotations a source has (said before it is removed).
pub fn count_for_source(conn: &Connection, source_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM source_annotations WHERE source_id = ?1 AND deleted_at IS NULL",
        [source_id],
        |r| r.get(0),
    )?)
}

/// Soft-deletes a source's annotations; called inside the removal of the
/// source itself.
pub fn remove_with_source(conn: &Connection, source_id: &str, at: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE source_annotations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE source_id = ?1 AND deleted_at IS NULL",
        params![source_id, at],
    )?;
    Ok(())
}

fn check_content(content: &str) -> AppResult<()> {
    if content.chars().count() > CONTENT_MAX_CHARS {
        return Err(invalid(
            "annotations.tooLong",
            "This note is too long to save.",
        ));
    }
    Ok(())
}

fn check_kind(kind: &str) -> AppResult<()> {
    if SOURCE_ANNOTATION_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            UserMessage::new("invalidChoice", format!("“{kind}” is not a kind of mark."))
                .with("value", kind),
        ))
    }
}

/// Checks a selection against the stored text and builds its anchor.
fn anchor_selection(conn: &Connection, input: &CreateSourceAnnotation) -> AppResult<Built> {
    let (Some(start), Some(end), Some(quote)) = (&input.start, &input.end, &input.quote) else {
        return Err(invalid(
            "sourceAnnotations.noWords",
            "Select some words of the source first.",
        ));
    };
    if quote.chars().count() > QUOTE_MAX_CHARS {
        return Err(invalid(
            "sourceAnnotations.tooMuchText",
            "So much text cannot be marked at once.",
        ));
    }
    let not_here = || {
        invalid(
            "sourceAnnotations.textChanged",
            "The selected words do not match the text of this source.",
        )
    };
    let (start_source, start_position) =
        segment_place(conn, &start.segment_id)?.ok_or_else(not_here)?;
    let (end_source, end_position) = segment_place(conn, &end.segment_id)?.ok_or_else(not_here)?;
    if start_source != input.source_id
        || end_source != input.source_id
        || end_position < start_position
    {
        return Err(not_here());
    }
    let segments = segments_between(conn, &input.source_id, start_position - 1, end_position + 1)?;
    let line = Line::new(&segments);
    let (Some(first), Some(last)) = (
        line.index_of(&start.segment_id),
        line.index_of(&end.segment_id),
    ) else {
        return Err(not_here());
    };
    let from = line.byte(LinePoint {
        index: first,
        offset: start.offset,
    });
    let to = line.byte(LinePoint {
        index: last,
        offset: end.offset,
    });
    let (Some(from), Some(to)) = (from, to) else {
        return Err(not_here());
    };
    if from > to || line.text[from..to] != *quote {
        return Err(not_here());
    }
    build(&line, from, to).ok_or_else(|| {
        invalid(
            "sourceAnnotations.noWords",
            "Select some words of the source first.",
        )
    })
}

/// Selected words of a source, checked exactly against its stored text, with
/// the paragraphs they lie in (v0.20: what the assistant is shown, and where
/// its quotations are looked for).
#[derive(Debug, Clone)]
pub struct Excerpt {
    /// The paragraphs from the first selected to the last, in reading order.
    pub segments: Vec<StoredSegment>,
    /// The selected words: bytes `from..to` of these paragraphs joined as a [`Line`].
    pub from: usize,
    pub to: usize,
    pub text: String,
}

impl Excerpt {
    /// The exact place of `from..to` (bytes of the joined paragraphs), as
    /// the reader and a citation name it; `None` for nothing visible.
    pub fn points(&self, from: usize, to: usize) -> Option<(TextPoint, TextPoint, String)> {
        let line = Line::new(&self.segments);
        let (start, end) = line.trimmed(from, to)?;
        let quote = line.quote(start, end)?.to_string();
        let point = |p: LinePoint| TextPoint {
            segment_id: self.segments[p.index].id.clone(),
            offset: p.offset,
        };
        Some((point(start), point(end), quote))
    }
}

/// The selected words `start..end` of a source, refused unless they are
/// exactly `quote` in its stored text (as a new mark is).
pub fn excerpt(
    conn: &Connection,
    source_id: &str,
    start: &TextPoint,
    end: &TextPoint,
    quote: &str,
) -> AppResult<Excerpt> {
    let not_here = || {
        invalid(
            "sourceAnnotations.textChanged",
            "The selected words do not match the text of this source.",
        )
    };
    let (start_source, first) = segment_place(conn, &start.segment_id)?.ok_or_else(not_here)?;
    let (end_source, last) = segment_place(conn, &end.segment_id)?.ok_or_else(not_here)?;
    if start_source != source_id || end_source != source_id || last < first {
        return Err(not_here());
    }
    let segments = segments_between(conn, source_id, first, last)?;
    let line = Line::new(&segments);
    let (Some(a), Some(b)) = (
        line.index_of(&start.segment_id),
        line.index_of(&end.segment_id),
    ) else {
        return Err(not_here());
    };
    let from = line.byte(LinePoint {
        index: a,
        offset: start.offset,
    });
    let to = line.byte(LinePoint {
        index: b,
        offset: end.offset,
    });
    let (Some(from), Some(to)) = (from, to) else {
        return Err(not_here());
    };
    if from >= to || line.text[from..to] != *quote || quote.trim().is_empty() {
        return Err(not_here());
    }
    let text = line.text[from..to].to_string();
    drop(line);
    Ok(Excerpt {
        segments,
        from,
        to,
        text,
    })
}

/// Where a place annotation sits.
struct Place {
    segment_id: Option<String>,
    position: Option<i64>,
    page_number: Option<i64>,
    locator: Option<String>,
    section_path: Option<String>,
    details: PlaceDetails,
}

fn anchor_place(conn: &Connection, input: &CreateSourceAnnotation) -> AppResult<Place> {
    let place = input.place.clone().unwrap_or_default();
    let fraction = place.fraction.map(|f| f.clamp(0.0, 1.0));
    if let Some(segment_id) = &place.segment_id {
        let segments = conn
            .prepare_cached(&format!(
                "{SEGMENT_SELECT} WHERE id = ?1 AND source_id = ?2 AND deleted_at IS NULL"
            ))?
            .query_map(params![segment_id, input.source_id], stored_segment)?
            .collect::<Result<Vec<_>, _>>()?;
        let segment = segments.into_iter().next().ok_or_else(|| {
            invalid(
                "sourceAnnotations.placeGone",
                "This place is no longer in the source.",
            )
        })?;
        return Ok(Place {
            segment_id: Some(segment.id),
            position: Some(segment.position),
            page_number: place.page.or(segment.page_number),
            locator: segment.locator,
            section_path: segment.section_path,
            details: PlaceDetails {
                v: 0,
                page: place.page,
                fraction,
            },
        });
    }
    // A page of an Original PDF with no text on it.
    let Some(page) = place.page else {
        return Err(invalid(
            "sourceAnnotations.noPlace",
            "Choose a place in the source first.",
        ));
    };
    let source = library::get(conn, &input.source_id)?;
    if source.format.as_deref() != Some("pdf")
        || page < 1
        || source.page_count.is_some_and(|count| page > count)
    {
        return Err(invalid(
            "sourceAnnotations.noPlace",
            "Choose a place in the source first.",
        ));
    }
    let position: Option<i64> = conn
        .query_row(
            "SELECT position FROM source_segments
             WHERE source_id = ?1 AND deleted_at IS NULL AND page_number >= ?2
             ORDER BY position LIMIT 1",
            params![input.source_id, page],
            |r| r.get(0),
        )
        .optional()?;
    Ok(Place {
        segment_id: None,
        position,
        page_number: Some(page),
        locator: Some(format!("p. {page}")),
        section_path: None,
        details: PlaceDetails {
            v: 0,
            page: Some(page),
            fraction,
        },
    })
}

fn source_file(conn: &Connection, source_id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM source_files WHERE source_id = ?1 AND is_primary = 1 AND deleted_at IS NULL",
            [source_id],
            |r| r.get(0),
        )
        .optional()?)
}

fn insert_words(
    conn: &Connection,
    source_id: &str,
    kind: &str,
    color: Option<&str>,
    content: &str,
    built: &Built,
    created_at: Option<&str>,
) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let id = new_id();
    let at = now();
    conn.execute(
        "INSERT INTO source_annotations
             (id, workspace_id, source_id, source_file_id, kind, color, content,
              start_segment_id, start_offset, end_segment_id, end_offset, quote, prefix, suffix,
              position, page_number, locator, section_path, anchor, anchor_state,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                 NULL, 'exact', ?19, ?20)",
        params![
            id,
            workspace.id,
            source_id,
            source_file(conn, source_id)?,
            kind,
            color,
            content,
            built.start_segment_id,
            built.start_offset,
            built.end_segment_id,
            built.end_offset,
            built.quote,
            built.prefix,
            built.suffix,
            built.position,
            built.page_number,
            built.locator,
            built.section_path,
            created_at.unwrap_or(&at),
            at
        ],
    )?;
    Ok(id)
}

/// Rewrites the words of an annotation (a moved or cut anchor).
fn write_words(conn: &Connection, id: &str, built: &Built, state: AnchorState) -> AppResult<()> {
    conn.execute(
        "UPDATE source_annotations
         SET start_segment_id = ?2, start_offset = ?3, end_segment_id = ?4, end_offset = ?5,
             quote = ?6, prefix = ?7, suffix = ?8, position = ?9, page_number = ?10,
             locator = ?11, section_path = ?12, anchor_state = ?13, revision = revision + 1
         WHERE id = ?1",
        params![
            id,
            built.start_segment_id,
            built.start_offset,
            built.end_segment_id,
            built.end_offset,
            built.quote,
            built.prefix,
            built.suffix,
            built.position,
            built.page_number,
            built.locator,
            built.section_path,
            state.as_str()
        ],
    )?;
    Ok(())
}

fn soft_delete(conn: &Connection, id: &str) -> AppResult<()> {
    let at = now();
    conn.execute(
        "UPDATE source_annotations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![id, at],
    )?;
    Ok(())
}

/// Creates a highlight, a note or a bookmark.
///
/// A highlight works like a highlighter on paper: highlights of the same
/// colour that overlap or touch it are merged into it, and highlights of
/// other colours are trimmed, split or removed where it covers them. A
/// bookmark on a place that already has one returns that bookmark. Notes are
/// never merged.
pub fn create(conn: &Connection, input: &CreateSourceAnnotation) -> AppResult<SourceAnnotation> {
    let kind = input.kind.as_str();
    check_kind(kind)?;
    library::get(conn, &input.source_id)?;
    let content = input.content.clone().unwrap_or_default();
    check_content(&content)?;
    if kind != "note" && !content.is_empty() {
        return Err(invalid(
            "sourceAnnotations.wordsOnlyNotes",
            "Only notes have words of their own.",
        ));
    }
    let color = match (&input.color, kind) {
        (Some(color), "highlight") => {
            validate_color(color)?;
            Some(color.clone())
        }
        (None, "highlight") => Some(DEFAULT_HIGHLIGHT_COLOR.to_string()),
        (Some(_), _) => {
            return Err(invalid(
                "annotations.colorOnlyHighlight",
                "Only highlights have a colour.",
            ))
        }
        (None, _) => None,
    };
    let on_words = input.start.is_some() || input.end.is_some() || input.quote.is_some();
    match kind {
        "highlight" if !on_words => {
            return Err(invalid(
                "sourceAnnotations.noWords",
                "Select some words of the source first.",
            ))
        }
        "bookmark" if on_words => {
            return Err(invalid(
                "sourceAnnotations.bookmarkPlace",
                "A bookmark marks a place, not words.",
            ))
        }
        _ => {}
    }

    if on_words {
        // Everything already in the source is put right first, so the
        // highlighter compares current places.
        resolve_source(conn, &input.source_id)?;
        let built = anchor_selection(conn, input)?;
        let tx = conn.unchecked_transaction()?;
        let id = if kind == "highlight" {
            highlight(
                &tx,
                &input.source_id,
                color.as_deref().unwrap_or(DEFAULT_HIGHLIGHT_COLOR),
                &built,
                None,
            )?
        } else {
            insert_words(&tx, &input.source_id, kind, None, &content, &built, None)?
        };
        tx.commit()?;
        return get(conn, &id);
    }

    let place = anchor_place(conn, input)?;
    if kind == "bookmark" {
        let existing: Option<String> = match &place.segment_id {
            Some(segment) => conn
                .query_row(
                    "SELECT id FROM source_annotations
                     WHERE source_id = ?1 AND kind = 'bookmark' AND deleted_at IS NULL
                       AND start_segment_id = ?2 AND anchor_state != 'unresolved'
                     ORDER BY created_at LIMIT 1",
                    params![input.source_id, segment],
                    |r| r.get(0),
                )
                .optional()?,
            None => conn
                .query_row(
                    "SELECT id FROM source_annotations
                     WHERE source_id = ?1 AND kind = 'bookmark' AND deleted_at IS NULL
                       AND start_segment_id IS NULL AND page_number = ?2
                     ORDER BY created_at LIMIT 1",
                    params![input.source_id, place.page_number],
                    |r| r.get(0),
                )
                .optional()?,
        };
        if let Some(id) = existing {
            return get(conn, &id);
        }
    }
    let workspace = workspaces::get_default(conn)?;
    let id = new_id();
    let at = now();
    conn.execute(
        "INSERT INTO source_annotations
             (id, workspace_id, source_id, source_file_id, kind, content, start_segment_id,
              end_segment_id, position, page_number, locator, section_path, anchor, anchor_state,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?12, 'exact', ?13, ?13)",
        params![
            id,
            workspace.id,
            input.source_id,
            source_file(conn, &input.source_id)?,
            kind,
            content,
            place.segment_id,
            place.position,
            place.page_number,
            place.locator,
            place.section_path,
            place.details.to_stored(),
            at
        ],
    )?;
    get(conn, &id)
}

/// A highlight on the page now.
struct Laid {
    raw: Raw,
    color: String,
    span: Span,
}

/// Applies a highlight like a highlighter on paper (see [`create`]); the
/// caller holds the transaction. Returns the id of the highlight that now
/// holds the words.
///
/// `own` is a highlight being recoloured: it takes no part as a neighbour,
/// and holds the result itself unless a same-colour neighbour absorbs it.
fn highlight(
    conn: &Connection,
    source_id: &str,
    color: &str,
    built: &Built,
    own: Option<&str>,
) -> AppResult<String> {
    let rows: Vec<Raw> = live_rows(conn, source_id)?
        .into_iter()
        .filter(|r| {
            r.kind == "highlight"
                && r.state != AnchorState::Unresolved
                && Some(r.id.as_str()) != own
        })
        .collect();
    let ids: Vec<&str> = rows
        .iter()
        .flat_map(|r| [r.start_segment_id.as_deref(), r.end_segment_id.as_deref()])
        .flatten()
        .collect();
    let at = positions(conn, &ids)?;
    let mut same: Vec<Laid> = Vec::new();
    let mut other: Vec<Laid> = Vec::new();
    for raw in rows {
        let span = match (
            raw.start_segment_id.as_ref().and_then(|id| at.get(id)),
            raw.end_segment_id.as_ref().and_then(|id| at.get(id)),
            raw.start_offset,
            raw.end_offset,
        ) {
            (Some(&from), Some(&to), Some(start), Some(end)) => Span {
                start: pack(from, start),
                end: pack(to, end),
            },
            _ => continue,
        };
        let laid = Laid {
            color: raw
                .color
                .clone()
                .unwrap_or_else(|| DEFAULT_HIGHLIGHT_COLOR.to_string()),
            raw,
            span,
        };
        if laid.color == color {
            same.push(laid);
        } else {
            other.push(laid);
        }
    }

    let (range, absorbed) = absorb(built.span, &same.iter().map(|h| h.span).collect::<Vec<_>>());
    let mut recolour: Option<usize> = None;
    for (i, old) in other.iter().enumerate() {
        if !old.span.overlaps(range) {
            continue;
        }
        if old.span == range && absorbed.is_empty() {
            recolour = Some(i);
            continue;
        }
        let (before, after) = remainders(old.span, range);
        let mut pieces = Vec::new();
        for piece in [before, after].into_iter().flatten() {
            if let Some(piece) = build_span(conn, source_id, piece)? {
                pieces.push(piece);
            }
        }
        let mut pieces = pieces.into_iter();
        match pieces.next() {
            None => soft_delete(conn, &old.raw.id)?,
            Some(keep) => {
                write_words(conn, &old.raw.id, &keep, old.raw.state)?;
                if let Some(split) = pieces.next() {
                    insert_words(
                        conn,
                        source_id,
                        "highlight",
                        Some(&old.color),
                        "",
                        &split,
                        Some(&old.raw.created_at),
                    )?;
                }
            }
        }
    }

    if let Some(&lead) = absorbed.first() {
        let lead = &same[lead];
        for &i in absorbed.iter().skip(1) {
            soft_delete(conn, &same[i].raw.id)?;
        }
        if lead.span != range {
            if let Some(grown) = build_span(conn, source_id, range)? {
                write_words(conn, &lead.raw.id, &grown, AnchorState::Exact)?;
            }
        }
        touch(conn, &lead.raw.id)?;
        if let Some(own) = own {
            soft_delete(conn, own)?;
        }
        return Ok(lead.raw.id.clone());
    }
    if let Some(own) = own {
        if let Some(i) = recolour {
            soft_delete(conn, &other[i].raw.id)?;
        }
        write_words(conn, own, built, AnchorState::Exact)?;
        conn.execute(
            "UPDATE source_annotations SET color = ?2, updated_at = ?3 WHERE id = ?1",
            params![own, color, now()],
        )?;
        return Ok(own.to_string());
    }
    if let Some(i) = recolour {
        let target = &other[i];
        conn.execute(
            "UPDATE source_annotations SET color = ?2, updated_at = ?3, revision = revision + 1
             WHERE id = ?1",
            params![target.raw.id, color, now()],
        )?;
        return Ok(target.raw.id.clone());
    }
    insert_words(conn, source_id, "highlight", Some(color), "", built, None)
}

fn touch(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE source_annotations SET updated_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    Ok(())
}

/// Changes a note's words or a highlight's colour.
pub fn update(conn: &Connection, input: &UpdateSourceAnnotation) -> AppResult<SourceAnnotation> {
    let raw = get_raw(conn, &input.id)?;
    if let Some(content) = &input.content {
        if raw.kind != "note" {
            return Err(invalid(
                "sourceAnnotations.wordsOnlyNotes",
                "Only notes have words of their own.",
            ));
        }
        check_content(content)?;
        if *content != raw.content {
            conn.execute(
                "UPDATE source_annotations SET content = ?2, updated_at = ?3, revision = revision + 1
                 WHERE id = ?1",
                params![raw.id, content, now()],
            )?;
        }
    }
    if let Some(color) = &input.color {
        if raw.kind != "highlight" {
            return Err(invalid(
                "annotations.colorOnlyHighlight",
                "Only highlights have a colour.",
            ));
        }
        validate_color(color)?;
        let current = raw.color.as_deref().unwrap_or(DEFAULT_HIGHLIGHT_COLOR);
        if current != color {
            // Recolouring is highlighting the same words again in the new
            // colour, so neighbours follow the same rules. A highlight that
            // cannot be found in the text only changes colour.
            resolve_source(conn, &raw.source_id)?;
            let raw = get_raw(conn, &raw.id)?;
            let built = match (&raw.start_segment_id, &raw.end_segment_id, raw.state) {
                (Some(_), Some(_), state) if state != AnchorState::Unresolved => {
                    let ids = [
                        raw.start_segment_id.as_deref().unwrap_or_default(),
                        raw.end_segment_id.as_deref().unwrap_or_default(),
                    ];
                    let at = positions(conn, &ids)?;
                    match (
                        at.get(ids[0]),
                        at.get(ids[1]),
                        raw.start_offset,
                        raw.end_offset,
                    ) {
                        (Some(&from), Some(&to), Some(start), Some(end)) => build_span(
                            conn,
                            &raw.source_id,
                            Span {
                                start: pack(from, start),
                                end: pack(to, end),
                            },
                        )?,
                        _ => None,
                    }
                }
                _ => None,
            };
            let tx = conn.unchecked_transaction()?;
            let id = match built {
                Some(built) => highlight(&tx, &raw.source_id, color, &built, Some(&raw.id))?,
                None => {
                    tx.execute(
                        "UPDATE source_annotations SET color = ?2, updated_at = ?3, revision = revision + 1
                         WHERE id = ?1",
                        params![raw.id, color, now()],
                    )?;
                    raw.id.clone()
                }
            };
            tx.commit()?;
            return get(conn, &id);
        }
    }
    get(conn, &input.id)
}

/// Soft delete: hidden everywhere, kept in the file.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    get_raw(conn, id)?;
    soft_delete(conn, id)
}

/// What [`resolve_source`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ResolveReport {
    pub exact: usize,
    pub moved: usize,
    pub unresolved: usize,
}

/// Finds every live annotation of a source again in its stored text (see
/// the module comment), and records any change. Cheap when nothing moved:
/// each annotation is checked against its own segments only, and the whole
/// text is read just once, and only if something has to be looked for.
pub fn resolve_source(conn: &Connection, source_id: &str) -> AppResult<ResolveReport> {
    let rows = live_rows(conn, source_id)?;
    let mut report = ResolveReport::default();
    let mut text: Option<Vec<StoredSegment>> = None;
    // Highlights now on other words than before: laid down again like a highlighter, so they
    // never overlap another colour (they took no part while unresolved).
    let mut relaid: Vec<(String, String)> = Vec::new();
    for raw in rows {
        let returned = raw.state == AnchorState::Unresolved;
        let outcome = if raw.quote.is_some() {
            resolve_words(conn, &raw, &mut text)?
        } else {
            resolve_place(conn, &raw, &mut text)?
        };
        let state = match outcome {
            Outcome::Here => {
                if returned {
                    set_state(conn, &raw.id, AnchorState::Moved)?;
                    if raw.kind == "highlight" {
                        relaid.push((
                            raw.id.clone(),
                            raw.color
                                .clone()
                                .unwrap_or_else(|| DEFAULT_HIGHLIGHT_COLOR.to_string()),
                        ));
                    }
                    AnchorState::Moved
                } else {
                    raw.state
                }
            }
            Outcome::Words(built) => {
                write_words(conn, &raw.id, &built, AnchorState::Moved)?;
                if raw.kind == "highlight" {
                    relaid.push((
                        raw.id.clone(),
                        raw.color
                            .clone()
                            .unwrap_or_else(|| DEFAULT_HIGHLIGHT_COLOR.to_string()),
                    ));
                }
                AnchorState::Moved
            }
            Outcome::Place(segment) => {
                conn.execute(
                    "UPDATE source_annotations
                     SET start_segment_id = ?2, end_segment_id = ?2, position = ?3,
                         page_number = COALESCE(?4, page_number), locator = ?5, section_path = ?6,
                         anchor_state = 'moved', revision = revision + 1
                     WHERE id = ?1",
                    params![
                        raw.id,
                        segment.id,
                        segment.position,
                        segment.page_number,
                        segment.locator,
                        segment.section_path
                    ],
                )?;
                AnchorState::Moved
            }
            Outcome::Lost => {
                if raw.state != AnchorState::Unresolved {
                    set_state(conn, &raw.id, AnchorState::Unresolved)?;
                }
                AnchorState::Unresolved
            }
        };
        match state {
            AnchorState::Exact => report.exact += 1,
            AnchorState::Moved => report.moved += 1,
            AnchorState::Unresolved => report.unresolved += 1,
        }
    }
    for (id, color) in relaid {
        relay(conn, source_id, &id, &color)?;
    }
    if report.moved + report.unresolved > 0 {
        log::debug!(
            "source marks checked: {} exact, {} moved, {} unresolved",
            report.exact,
            report.moved,
            report.unresolved
        );
    }
    Ok(report)
}

/// Lays a highlight that was found on other words down again, as a highlighter would, so that
/// it merges with its own colour and other colours give way. It stays `moved`.
fn relay(conn: &Connection, source_id: &str, id: &str, color: &str) -> AppResult<()> {
    let Ok(raw) = get_raw(conn, id) else {
        return Ok(()); // merged into a neighbour laid down before it
    };
    let (Some(start), Some(end), Some(from), Some(to)) = (
        raw.start_segment_id.as_deref(),
        raw.end_segment_id.as_deref(),
        raw.start_offset,
        raw.end_offset,
    ) else {
        return Ok(());
    };
    let at = positions(conn, &[start, end])?;
    let (Some(&first), Some(&last)) = (at.get(start), at.get(end)) else {
        return Ok(());
    };
    let span = Span {
        start: pack(first, from),
        end: pack(last, to),
    };
    let Some(built) = build_span(conn, source_id, span)? else {
        return Ok(());
    };
    let tx = conn.unchecked_transaction()?;
    let kept = highlight(&tx, source_id, color, &built, Some(id))?;
    set_state(&tx, &kept, AnchorState::Moved)?;
    tx.commit()?;
    Ok(())
}

fn set_state(conn: &Connection, id: &str, state: AnchorState) -> AppResult<()> {
    conn.execute(
        "UPDATE source_annotations SET anchor_state = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, state.as_str()],
    )?;
    Ok(())
}

enum Outcome {
    /// Where it was stored.
    Here,
    /// Found again on these words.
    Words(Built),
    /// A place found again at this paragraph.
    Place(StoredSegment),
    Lost,
}

fn whole_text<'a>(
    conn: &Connection,
    source_id: &str,
    text: &'a mut Option<Vec<StoredSegment>>,
) -> AppResult<&'a [StoredSegment]> {
    if text.is_none() {
        *text = Some(all_segments(conn, source_id)?);
    }
    Ok(text.as_deref().unwrap_or_default())
}

/// The index of the segment nearest a reading position.
fn nearest(segments: &[StoredSegment], position: i64) -> Option<usize> {
    if segments.is_empty() {
        return None;
    }
    Some(
        segments
            .partition_point(|s| s.position < position)
            .min(segments.len() - 1),
    )
}

fn resolve_words(
    conn: &Connection,
    raw: &Raw,
    text: &mut Option<Vec<StoredSegment>>,
) -> AppResult<Outcome> {
    let quote = raw.quote.as_deref().unwrap_or_default();
    let prefix = raw.prefix.as_deref().unwrap_or_default();
    let suffix = raw.suffix.as_deref().unwrap_or_default();

    // 1. Where it was stored.
    let start = match &raw.start_segment_id {
        Some(id) => segment_place(conn, id)?.filter(|(source, _)| *source == raw.source_id),
        None => None,
    };
    let end = match &raw.end_segment_id {
        Some(id) => segment_place(conn, id)?.filter(|(source, _)| *source == raw.source_id),
        None => None,
    };
    if let (Some((_, from)), Some((_, to)), Some(start_offset), Some(end_offset)) =
        (&start, &end, raw.start_offset, raw.end_offset)
    {
        if from <= to {
            let segments = segments_between(conn, &raw.source_id, *from, *to)?;
            let line = Line::new(&segments);
            let first = raw
                .start_segment_id
                .as_deref()
                .and_then(|id| line.index_of(id));
            let last = raw
                .end_segment_id
                .as_deref()
                .and_then(|id| line.index_of(id));
            if let (Some(first), Some(last)) = (first, last) {
                let here = line.quote(
                    LinePoint {
                        index: first,
                        offset: start_offset,
                    },
                    LinePoint {
                        index: last,
                        offset: end_offset,
                    },
                );
                if here == Some(quote) {
                    return Ok(Outcome::Here);
                }
            }
        }
    }

    let segments = whole_text(conn, &raw.source_id, text)?;
    if segments.is_empty() || quote.is_empty() {
        return Ok(Outcome::Lost);
    }
    let line = Line::new(segments);
    let occurrences = line.occurrences(quote);
    if occurrences.is_empty() {
        return Ok(Outcome::Lost);
    }
    let found = |from: usize, to: usize| match build(&line, from, to) {
        // The quote has no white space at its ends, so building cannot
        // change it; anything else is not the same words.
        Some(built) if built.quote == quote => Outcome::Words(built),
        _ => Outcome::Lost,
    };
    let survivors: Vec<usize> = [&raw.start_segment_id, &raw.end_segment_id]
        .into_iter()
        .flatten()
        .filter_map(|id| line.index_of(id))
        .collect();

    // 2. In the segments it was on.
    if let (Some(&first), Some(&last)) = (survivors.iter().min(), survivors.iter().max()) {
        match pick(
            &line,
            &occurrences,
            line.bytes_of(first, last),
            prefix,
            suffix,
            false,
        ) {
            Pick::One(from, to) => return Ok(found(from, to)),
            Pick::Ambiguous => return Ok(Outcome::Lost),
            Pick::None => {}
        }
    }

    // 3. Nearby, with its context.
    let centre = survivors
        .first()
        .copied()
        .or_else(|| raw.position.and_then(|p| nearest(segments, p)));
    if let Some(centre) = centre {
        let first = centre.saturating_sub(NEARBY);
        let last = (centre + NEARBY).min(segments.len() - 1);
        match pick(
            &line,
            &occurrences,
            line.bytes_of(first, last),
            prefix,
            suffix,
            true,
        ) {
            Pick::One(from, to) => return Ok(found(from, to)),
            Pick::Ambiguous => return Ok(Outcome::Lost),
            Pick::None => {}
        }
    }

    // 4. On the same page, or in the same section.
    let same_place: Vec<usize> = segments
        .iter()
        .enumerate()
        .filter(|(_, s)| match (raw.page_number, &raw.section_path) {
            (Some(page), _) => s.page_number == Some(page),
            (None, Some(path)) => s.section_path.as_ref() == Some(path),
            (None, None) => false,
        })
        .map(|(i, _)| i)
        .collect();
    if let (Some(&first), Some(&last)) = (same_place.first(), same_place.last()) {
        match pick(
            &line,
            &occurrences,
            line.bytes_of(first, last),
            prefix,
            suffix,
            true,
        ) {
            Pick::One(from, to) => return Ok(found(from, to)),
            Pick::Ambiguous => return Ok(Outcome::Lost),
            Pick::None => {}
        }
    }

    // 5. Anywhere in the source.
    match pick(
        &line,
        &occurrences,
        (0, line.text.len()),
        prefix,
        suffix,
        true,
    ) {
        Pick::One(from, to) => Ok(found(from, to)),
        _ => Ok(Outcome::Lost),
    }
}

fn resolve_place(
    conn: &Connection,
    raw: &Raw,
    text: &mut Option<Vec<StoredSegment>>,
) -> AppResult<Outcome> {
    if let Some(id) = &raw.start_segment_id {
        if segment_place(conn, id)?.is_some_and(|(source, _)| source == raw.source_id) {
            return Ok(Outcome::Here);
        }
    }
    // A place on an Original PDF page is the page: the file never changes.
    let details = PlaceDetails::read(raw.anchor.as_deref());
    if details.page.is_some() && raw.start_segment_id.is_none() {
        return Ok(Outcome::Here);
    }
    let segments = whole_text(conn, &raw.source_id, text)?;
    let first_of = |matches: &dyn Fn(&StoredSegment) -> bool| segments.iter().find(|s| matches(s));
    let found = match (details.page.or(raw.page_number), &raw.section_path) {
        (Some(page), _) => first_of(&|s| s.page_number == Some(page)),
        (None, Some(path)) => first_of(&|s| s.section_path.as_ref() == Some(path)),
        (None, None) => None,
    };
    Ok(match found {
        Some(segment) => Outcome::Place(segment.clone()),
        None => Outcome::Lost,
    })
}

// ---------------------------------------------------------------------------
// Citations from a source into a Study (v0.15). A finding's citation keeps its
// own copy of the quote and of where it was: it is anchored here with the
// same rules as an annotation, and found again with the same resolver, but it
// never depends on an annotation continuing to exist.
// ---------------------------------------------------------------------------

/// What a finding's citation records about the cited words or place.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cited {
    pub source_id: String,
    /// The paragraph the words or place begin in, if known.
    pub segment_id: Option<String>,
    pub quote: Option<String>,
    pub locator: Option<String>,
    pub section_path: Option<String>,
    pub anchor: CitationAnchor,
    pub annotation_id: Option<String>,
}

fn words_anchor(built: &Built) -> CitationAnchor {
    CitationAnchor {
        v: CitationAnchor::VERSION,
        start_segment_id: Some(built.start_segment_id.clone()),
        start_offset: Some(built.start_offset),
        end_segment_id: Some(built.end_segment_id.clone()),
        end_offset: Some(built.end_offset),
        prefix: Some(built.prefix.clone()),
        suffix: Some(built.suffix.clone()),
        position: Some(built.position),
        page_number: built.page_number,
        ..Default::default()
    }
}

fn from_words(source_id: &str, built: Built, annotation_id: Option<String>) -> Cited {
    Cited {
        source_id: source_id.to_string(),
        segment_id: Some(built.start_segment_id.clone()),
        anchor: words_anchor(&built),
        quote: Some(built.quote),
        locator: built.locator,
        section_path: built.section_path,
        annotation_id,
    }
}

fn from_place(source_id: &str, place: Place, annotation_id: Option<String>) -> Cited {
    Cited {
        source_id: source_id.to_string(),
        segment_id: place.segment_id.clone(),
        quote: None,
        locator: place.locator,
        section_path: place.section_path,
        anchor: CitationAnchor {
            v: CitationAnchor::VERSION,
            start_segment_id: place.segment_id,
            position: place.position,
            page_number: place.page_number,
            page: place.details.page,
            fraction: place.details.fraction,
            ..Default::default()
        },
        annotation_id,
    }
}

/// Anchors what a finding cites: selected words (checked against the stored
/// text exactly as a highlight is), a place, or a source mark — whose words
/// or place are copied, so the citation never depends on the mark.
pub(crate) fn cite(conn: &Connection, input: &CitedPassage) -> AppResult<Cited> {
    if let Some(annotation_id) = &input.annotation_id {
        let raw = get_raw(conn, annotation_id)?;
        if input
            .source_id
            .as_deref()
            .is_some_and(|s| s != raw.source_id)
        {
            return Err(AppError::not_found("source annotation", annotation_id));
        }
        library::get(conn, &raw.source_id)?;
        if raw.kind == "bookmark" {
            return Err(invalid(
                "sourceAnnotations.bookmarkNotStudy",
                "A bookmark marks a place; it has nothing to add to a study.",
            ));
        }
        let link = Some(annotation_id.clone());
        if let Some(quote) = raw.quote.clone() {
            // Its words where they are now, checked as a new selection would be.
            if let (Some(start), Some(end), Some(from), Some(to)) = (
                raw.start_segment_id.clone(),
                raw.end_segment_id.clone(),
                raw.start_offset,
                raw.end_offset,
            ) {
                let selection = CreateSourceAnnotation {
                    source_id: raw.source_id.clone(),
                    start: Some(TextPoint {
                        segment_id: start,
                        offset: from,
                    }),
                    end: Some(TextPoint {
                        segment_id: end,
                        offset: to,
                    }),
                    quote: Some(quote.clone()),
                    ..Default::default()
                };
                if let Ok(built) = anchor_selection(conn, &selection) {
                    return Ok(from_words(&raw.source_id, built, link));
                }
            }
            // A mark that can no longer be found: its words, and where it was, without a place.
            return Ok(Cited {
                source_id: raw.source_id.clone(),
                segment_id: None,
                quote: Some(quote),
                locator: raw.locator.clone(),
                section_path: raw.section_path.clone(),
                anchor: CitationAnchor {
                    v: CitationAnchor::VERSION,
                    prefix: raw.prefix.clone(),
                    suffix: raw.suffix.clone(),
                    position: raw.position,
                    page_number: raw.page_number,
                    ..Default::default()
                },
                annotation_id: link,
            });
        }
        // A note on a place: the same place.
        let details = PlaceDetails::read(raw.anchor.as_deref());
        let live_segment = match &raw.start_segment_id {
            Some(id) => segment_place(conn, id)?
                .filter(|(source, _)| *source == raw.source_id)
                .map(|_| id.clone()),
            None => None,
        };
        let place = Place {
            segment_id: live_segment,
            position: raw.position,
            page_number: raw.page_number,
            locator: raw.locator.clone(),
            section_path: raw.section_path.clone(),
            details,
        };
        return Ok(from_place(&raw.source_id, place, link));
    }
    let source_id = input.source_id.clone().ok_or_else(|| {
        invalid(
            "sourceAnnotations.noWords",
            "Select some words of the source first.",
        )
    })?;
    library::get(conn, &source_id)?;
    if input.start.is_some() || input.end.is_some() || input.quote.is_some() {
        let selection = CreateSourceAnnotation {
            source_id: source_id.clone(),
            start: input.start.clone(),
            end: input.end.clone(),
            quote: input.quote.clone(),
            ..Default::default()
        };
        let built = anchor_selection(conn, &selection)?;
        return Ok(from_words(&source_id, built, None));
    }
    let request = CreateSourceAnnotation {
        source_id: source_id.clone(),
        place: input.place.clone(),
        ..Default::default()
    };
    let place = anchor_place(conn, &request)?;
    Ok(from_place(&source_id, place, None))
}

/// Where a citation is in its source now, to open it there; None when the
/// source has been removed. Its own anchor first (found again with the
/// annotation resolver, so moved words are followed only when unambiguous),
/// then the paragraph it was in, then its page or section, else the start of
/// the source. Words are only ever given when they were found exactly.
pub(crate) fn locate_citation(
    conn: &Connection,
    source_id: &str,
    segment_id: Option<&str>,
    quote: Option<&str>,
    section_path: Option<&str>,
    anchor: Option<&CitationAnchor>,
) -> AppResult<Option<CitationPlace>> {
    let live: bool = conn
        .query_row(
            "SELECT deleted_at IS NULL FROM sources WHERE id = ?1",
            [source_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if !live {
        return Ok(None);
    }
    let mut place = CitationPlace {
        source_id: source_id.to_string(),
        segment_id: None,
        words: None,
        page: None,
        fraction: None,
    };
    let paragraph = |id: Option<&str>| -> AppResult<Option<String>> {
        Ok(match id {
            Some(id) => segment_place(conn, id)?
                .filter(|(source, _)| source == source_id)
                .map(|_| id.to_string()),
            None => None,
        })
    };
    if let Some(anchor) = anchor {
        let raw = Raw {
            id: String::new(),
            source_id: source_id.to_string(),
            kind: if quote.is_some() { "highlight" } else { "note" }.into(),
            color: None,
            content: String::new(),
            start_segment_id: anchor.start_segment_id.clone(),
            start_offset: anchor.start_offset,
            end_segment_id: anchor.end_segment_id.clone(),
            end_offset: anchor.end_offset,
            quote: quote.map(str::to_string),
            prefix: anchor.prefix.clone(),
            suffix: anchor.suffix.clone(),
            position: anchor.position,
            page_number: anchor.page_number,
            locator: None,
            section_path: section_path.map(str::to_string),
            anchor: PlaceDetails {
                v: 0,
                page: anchor.page,
                fraction: anchor.fraction,
            }
            .to_stored(),
            state: AnchorState::Exact,
            created_at: String::new(),
            updated_at: String::new(),
            revision: 0,
        };
        let mut text = None;
        let outcome = if raw.quote.is_some() {
            resolve_words(conn, &raw, &mut text)?
        } else {
            resolve_place(conn, &raw, &mut text)?
        };
        match outcome {
            Outcome::Here if raw.quote.is_some() => {
                if let (Some(start), Some(end), Some(from), Some(to)) = (
                    &raw.start_segment_id,
                    &raw.end_segment_id,
                    raw.start_offset,
                    raw.end_offset,
                ) {
                    place.segment_id = Some(start.clone());
                    place.words = Some(CitationWords {
                        start_segment_id: start.clone(),
                        start_offset: from,
                        end_segment_id: end.clone(),
                        end_offset: to,
                    });
                    return Ok(Some(place));
                }
            }
            Outcome::Here => {
                place.segment_id = paragraph(raw.start_segment_id.as_deref())?;
                // A place cited on an Original PDF page reopens on that page, as far down as it was.
                place.page = anchor.page;
                place.fraction = anchor.fraction;
                return Ok(Some(place));
            }
            Outcome::Words(built) => {
                place.segment_id = Some(built.start_segment_id.clone());
                place.words = Some(CitationWords {
                    start_segment_id: built.start_segment_id,
                    start_offset: built.start_offset,
                    end_segment_id: built.end_segment_id,
                    end_offset: built.end_offset,
                });
                return Ok(Some(place));
            }
            Outcome::Place(segment) => {
                place.segment_id = Some(segment.id);
                place.page = anchor.page;
                place.fraction = anchor.fraction;
                return Ok(Some(place));
            }
            Outcome::Lost => {}
        }
        // Not found for certain: the paragraph it began in, if it is still there (no words marked).
        if let Some(id) = paragraph(anchor.start_segment_id.as_deref())? {
            place.segment_id = Some(id);
            return Ok(Some(place));
        }
        // Else its page or section.
        let page = anchor.page.or(anchor.page_number);
        let found: Option<String> = match (page, section_path) {
            (Some(page), _) => conn
                .query_row(
                    "SELECT id FROM source_segments WHERE source_id = ?1 AND deleted_at IS NULL
                     AND page_number >= ?2 ORDER BY position LIMIT 1",
                    params![source_id, page],
                    |r| r.get(0),
                )
                .optional()?,
            (None, Some(path)) => conn
                .query_row(
                    "SELECT id FROM source_segments WHERE source_id = ?1 AND deleted_at IS NULL
                     AND section_path = ?2 ORDER BY position LIMIT 1",
                    params![source_id, path],
                    |r| r.get(0),
                )
                .optional()?,
            (None, None) => None,
        };
        place.segment_id = found;
        return Ok(Some(place));
    }
    // A citation from before v0.15: the paragraph, as always.
    place.segment_id = paragraph(segment_id)?;
    Ok(Some(place))
}
