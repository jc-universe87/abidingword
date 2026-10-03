//! Scripture annotations: notes, highlights and bookmarks on a canonical
//! passage. They belong to the passage, not to a translation, so they stay
//! in place when the reader switches translation or a translation is removed.
//!
//! A phrase highlight or phrase note also carries an anchor to the exact
//! wording it was made on (`data`, see scripture/annotation_data.rs); the
//! phrase is drawn only where a translation's text is verified identical.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{bibles, new_id, now, workspaces};
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::annotation_data::{
    build_anchor, validate_color, wording_matches, AnchorPoint, AnnotationData, StoredAnchor,
    DEFAULT_HIGHLIGHT_COLOR,
};
use crate::scripture::canon;
use crate::scripture::phrase_ranges::{absorb, remainders, Layout, Span};
use crate::scripture::reference::{split_key, verse_key, Point, ScriptureRef};
use crate::scripture::{
    AnchorEnd, AnchorInput, AnchorView, Annotation, CreateAnnotation, UpdateAnnotation,
    ANNOTATION_KINDS,
};

const COLUMNS: &str =
    "id, passage, translation_id, kind, content, data, created_at, updated_at, revision";

const CONTENT_MAX_CHARS: usize = 20_000;

struct RawAnnotation {
    id: String,
    passage: String,
    translation_id: Option<String>,
    kind: String,
    content: String,
    data: Option<String>,
    created_at: String,
    updated_at: String,
    revision: i64,
}

fn from_row(row: &Row) -> rusqlite::Result<RawAnnotation> {
    Ok(RawAnnotation {
        id: row.get(0)?,
        passage: row.get(1)?,
        translation_id: row.get(2)?,
        kind: row.get(3)?,
        content: row.get(4)?,
        data: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        revision: row.get(8)?,
    })
}

/// Turns a stored row into what the interface sees. `translation` is the
/// translation the reader shows: phrase anchors report whether its wording
/// matches.
fn to_annotation(
    conn: &Connection,
    raw: RawAnnotation,
    translation: Option<&str>,
) -> AppResult<Annotation> {
    let data = AnnotationData::read(raw.data.as_deref());
    let color = (raw.kind == "highlight").then(|| {
        data.color
            .clone()
            .unwrap_or_else(|| DEFAULT_HIGHLIGHT_COLOR.into())
    });
    let anchor = match &data.anchor {
        Some(anchor) => Some(anchor_view(conn, anchor, translation)?),
        None => None,
    };
    Ok(Annotation {
        id: raw.id,
        reference: ScriptureRef::from_canonical(&raw.passage)?.to_dto(),
        translation_id: raw.translation_id,
        kind: raw.kind,
        content: raw.content,
        color,
        anchor,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        revision: raw.revision,
    })
}

fn verse_canonical(key: i64) -> String {
    let (ordinal, chapter, verse) = split_key(key);
    let code = canon::by_ordinal(ordinal).map_or("", |b| b.code);
    format!("{code}.{chapter}.{verse}")
}

fn anchor_view(
    conn: &Connection,
    anchor: &StoredAnchor,
    translation: Option<&str>,
) -> AppResult<AnchorView> {
    let shown = match translation {
        Some(id) => wording_matches(
            anchor,
            &verse_texts(conn, id, anchor.start.verse, anchor.end.verse)?,
        ),
        None => false,
    };
    Ok(AnchorView {
        start: AnchorEnd {
            verse: verse_canonical(anchor.start.verse),
            offset: anchor.start.offset,
        },
        end: AnchorEnd {
            verse: verse_canonical(anchor.end.verse),
            offset: anchor.end.offset,
        },
        quote: anchor.quote.clone(),
        translation_short_name: anchor.translation_short_name.clone(),
        shown,
    })
}

/// One translation's stored text for a verse-key range, in order.
fn verse_texts(
    conn: &Connection,
    translation: &str,
    from_key: i64,
    to_key: i64,
) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare_cached(
        "SELECT verse_id, text FROM bible_verse_texts
         WHERE translation_id = ?1 AND verse_id BETWEEN ?2 AND ?3
         ORDER BY verse_id",
    )?;
    let rows = stmt.query_map(params![translation, from_key, to_key], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn single_verse(canonical: &str) -> AppResult<ScriptureRef> {
    let reference = ScriptureRef::from_canonical(canonical)?;
    if !reference.is_single_verse() {
        return Err(AppError::InvalidReference(
            UserMessage::new(
                "annotations.notSingleVerse",
                format!("“{canonical}” is not a single verse."),
            )
            .with("passage", canonical),
        ));
    }
    Ok(reference)
}

/// Checks a phrase selection against one translation's stored text and
/// builds its anchor. Returns the verse range it covers. Nothing is saved.
pub fn resolve_anchor(
    conn: &Connection,
    input: &AnchorInput,
) -> AppResult<(ScriptureRef, StoredAnchor)> {
    let start = single_verse(&input.start.verse)?;
    let end = single_verse(&input.end.verse)?;
    if start.book.ordinal != end.book.ordinal || start.start.chapter != end.start.chapter {
        return Err(AppError::InvalidInput(UserMessage::new(
            "annotations.oneChapter",
            "A marked phrase must stay within one chapter.",
        )));
    }
    let reference = ScriptureRef::new(
        start.book,
        start.start,
        Point {
            chapter: end.start.chapter,
            verse: end.start.verse,
        },
    )?;
    let translation = bibles::get(conn, &input.translation_id)?;
    let texts = verse_texts(
        conn,
        &translation.id,
        reference.start_key(),
        reference.end_key(),
    )?;
    let anchor = build_anchor(
        &texts,
        AnchorPoint {
            verse: reference.start_key(),
            offset: input.start.offset,
        },
        AnchorPoint {
            verse: reference.end_key(),
            offset: input.end.offset,
        },
        &translation.short_name,
    )?;
    if anchor.quote != input.quote {
        return Err(AppError::InvalidInput(UserMessage::new(
            "annotations.wordingMismatch",
            "The selected words do not match the text of this translation.",
        )));
    }
    Ok((reference, anchor))
}

/// Checks a phrase selection without saving it: the anchor as it would be
/// stored, shown in the translation it was made in.
pub fn check_anchor(conn: &Connection, input: &AnchorInput) -> AppResult<AnchorView> {
    let (_, anchor) = resolve_anchor(conn, input)?;
    anchor_view(conn, &anchor, Some(&input.translation_id))
}

/// Live annotations overlapping a passage, in canonical order. Phrase
/// anchors are not checked against any translation (`shown` is false).
pub fn list(conn: &Connection, reference: &ScriptureRef) -> AppResult<Vec<Annotation>> {
    list_for(conn, reference, None)
}

/// Live annotations overlapping a passage, in canonical order, with phrase
/// anchors checked against the translation the reader shows.
pub fn list_for(
    conn: &Connection,
    reference: &ScriptureRef,
    translation: Option<&str>,
) -> AppResult<Vec<Annotation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM annotations
         WHERE deleted_at IS NULL AND passage IS NOT NULL
           AND start_key <= ?2 AND end_key >= ?1
         ORDER BY start_key, created_at, rowid"
    ))?;
    let rows = stmt
        .query_map(
            params![reference.start_key(), reference.end_key()],
            from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|raw| to_annotation(conn, raw, translation))
        .collect()
}

fn get_raw(conn: &Connection, id: &str) -> AppResult<RawAnnotation> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM annotations WHERE id = ?1 AND deleted_at IS NULL AND passage IS NOT NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("note", id))
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Annotation> {
    get_for(conn, id, None)
}

fn get_for(conn: &Connection, id: &str, translation: Option<&str>) -> AppResult<Annotation> {
    let raw = get_raw(conn, id)?;
    to_annotation(conn, raw, translation)
}

fn check_content(content: &str) -> AppResult<()> {
    if content.chars().count() > CONTENT_MAX_CHARS {
        return Err(AppError::InvalidInput(UserMessage::new(
            "annotations.tooLong",
            "This note is too long to save.",
        )));
    }
    Ok(())
}

/// Sets a highlight's colour (stored explicitly from then on).
fn recolour(conn: &Connection, raw: &RawAnnotation, color: &str) -> AppResult<()> {
    let mut data = AnnotationData::read(raw.data.as_deref());
    if data.color.as_deref() == Some(color) {
        return Ok(());
    }
    data.color = Some(color.into());
    conn.execute(
        "UPDATE annotations SET data = ?2, updated_at = ?3, revision = revision + 1 WHERE id = ?1",
        params![raw.id, data.to_stored(), now()],
    )?;
    Ok(())
}

/// Creates an annotation.
///
/// Duplicates are not made: a bookmark, or a verse highlight, on exactly
/// the same passage — or a phrase highlight on exactly the same words — is
/// returned instead (a highlight recoloured to the colour asked for).
/// Notes are never merged.
pub fn create(conn: &Connection, input: &CreateAnnotation) -> AppResult<Annotation> {
    let kind = input.kind.as_str();
    if !ANNOTATION_KINDS.contains(&kind) {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "invalidChoice",
                format!("“{}” is not a kind of annotation.", input.kind),
            )
            .with("value", &input.kind),
        ));
    }
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    let content = input.content.clone().unwrap_or_default();
    check_content(&content)?;

    let color = match (&input.color, kind) {
        (Some(color), "highlight") => {
            validate_color(color)?;
            Some(color.clone())
        }
        (None, "highlight") => Some(DEFAULT_HIGHLIGHT_COLOR.to_string()),
        (Some(_), _) => {
            return Err(AppError::InvalidInput(UserMessage::new(
                "annotations.colorOnlyHighlight",
                "Only highlights have a colour.",
            )))
        }
        (None, _) => None,
    };

    let mut translation_id = input.translation_id.clone();
    let anchor = match &input.anchor {
        None => None,
        Some(_) if kind == "bookmark" => {
            return Err(AppError::InvalidInput(UserMessage::new(
                "annotations.bookmarkWholeVerse",
                "A bookmark marks whole verses, not words.",
            )))
        }
        Some(anchor_input) => {
            if translation_id
                .as_ref()
                .is_some_and(|t| *t != anchor_input.translation_id)
            {
                return Err(AppError::InvalidInput(UserMessage::new(
                    "annotations.otherTranslation",
                    "The phrase belongs to a different translation.",
                )));
            }
            let (covered, anchor) = resolve_anchor(conn, anchor_input)?;
            if covered.canonical() != reference.canonical() {
                return Err(AppError::InvalidInput(UserMessage::new(
                    "annotations.notInPassage",
                    "The selected words are not in this passage.",
                )));
            }
            translation_id = Some(anchor_input.translation_id.clone());
            Some(anchor)
        }
    };
    if let Some(translation) = &translation_id {
        bibles::get(conn, translation)?;
    }

    // A phrase highlight owns exactly the words just selected: highlights
    // already on that wording are merged, trimmed or split around it, all in
    // one transaction (see `highlight_phrase`).
    if let (true, Some(anchor), Some(translation)) = (kind == "highlight", &anchor, &translation_id)
    {
        let color = color.as_deref().unwrap_or(DEFAULT_HIGHLIGHT_COLOR);
        let tx = conn.unchecked_transaction()?;
        let id = highlight_phrase(&tx, translation, color, anchor)?;
        tx.commit()?;
        return get_for(conn, &id, Some(translation));
    }

    if kind != "note" {
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM annotations
             WHERE deleted_at IS NULL AND passage = ?1 AND kind = ?2
             ORDER BY created_at, rowid"
        ))?;
        let candidates = stmt
            .query_map(params![reference.canonical(), kind], from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        let existing = candidates.into_iter().find(|raw| {
            let stored = AnnotationData::read(raw.data.as_deref()).anchor;
            match (&stored, &anchor) {
                (None, None) => true,
                (Some(a), Some(b)) => a.same_place(b),
                _ => false,
            }
        });
        if let Some(raw) = existing {
            if let Some(color) = &color {
                recolour(conn, &raw, color)?;
            }
            return get_for(conn, &raw.id, translation_id.as_deref());
        }
    }

    let data = AnnotationData {
        v: 0,
        color,
        anchor,
    };
    let workspace = workspaces::get_default(conn)?;
    let id = new_id();
    let now = now();
    conn.execute(
        "INSERT INTO annotations
             (id, workspace_id, passage, start_key, end_key, translation_id, kind, content, data,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            workspace.id,
            reference.canonical(),
            reference.start_key(),
            reference.end_key(),
            translation_id,
            kind,
            content,
            data.to_stored(),
            now
        ],
    )?;
    get_for(conn, &id, translation_id.as_deref())
}

/// Changes a note's text and/or a highlight's colour.
pub fn update(conn: &Connection, input: &UpdateAnnotation) -> AppResult<Annotation> {
    let raw = get_raw(conn, &input.id)?;
    if let Some(color) = &input.color {
        if raw.kind != "highlight" {
            return Err(AppError::InvalidInput(UserMessage::new(
                "annotations.colorOnlyHighlight",
                "Only highlights have a colour.",
            )));
        }
        validate_color(color)?;
    }
    if let Some(content) = &input.content {
        check_content(content)?;
        if *content != raw.content {
            conn.execute(
                "UPDATE annotations SET content = ?2, updated_at = ?3, revision = revision + 1 WHERE id = ?1",
                params![input.id, content, now()],
            )?;
        }
    }
    if let Some(color) = &input.color {
        let data = AnnotationData::read(raw.data.as_deref());
        // A phrase highlight recoloured is the same as highlighting its words
        // again in the new colour, so neighbours and overlaps follow the same
        // rules. If its wording can no longer be checked (its translation was
        // removed), only the colour changes.
        if let (Some(anchor), Some(translation), true) =
            (&data.anchor, &raw.translation_id, raw.kind == "highlight")
        {
            if data.color.as_deref().unwrap_or(DEFAULT_HIGHLIGHT_COLOR) != color.as_str() {
                let texts = verse_texts(conn, translation, anchor.start.verse, anchor.end.verse)?;
                if wording_matches(anchor, &texts) {
                    let tx = conn.unchecked_transaction()?;
                    let id = highlight_phrase(&tx, translation, color, anchor)?;
                    tx.commit()?;
                    return get_for(conn, &id, Some(translation));
                }
            }
        }
        recolour(conn, &raw, color)?;
    }
    get(conn, &input.id)
}

/// Soft delete: hidden everywhere, kept in the file.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    get_raw(conn, id)?;
    let now = now();
    conn.execute(
        "UPDATE annotations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

/// A phrase highlight that is on screen in one wording.
struct PhraseHighlight {
    raw: RawAnnotation,
    color: String,
    anchor: StoredAnchor,
    span: Span,
}

/// The canonical passage, start key and end key an anchor covers.
fn covered(anchor: &StoredAnchor) -> AppResult<ScriptureRef> {
    let one = |key: i64| verse_canonical(key);
    let text = if anchor.start.verse == anchor.end.verse {
        one(anchor.start.verse)
    } else {
        format!("{}-{}", one(anchor.start.verse), one(anchor.end.verse))
    };
    ScriptureRef::from_canonical(&text)
}

/// Rebuilds an anchor for `span` from the stored text, the same way a new
/// selection is checked: offsets validated, quote rebuilt, verses hashed.
fn rebuild(
    layout: &Layout,
    texts: &[(i64, String)],
    span: Span,
    short_name: &str,
) -> AppResult<StoredAnchor> {
    let unreachable =
        || AppError::Unexpected("a highlight range does not lie inside its chapter's text".into());
    let start = layout.start_point(span.start).ok_or_else(unreachable)?;
    let end = layout.end_point(span.end).ok_or_else(unreachable)?;
    build_anchor(texts, start, end, short_name)
}

/// Rewrites a highlight's anchor (and the columns derived from it).
fn write_anchor(
    conn: &Connection,
    id: &str,
    color: &str,
    anchor: &StoredAnchor,
    translation_id: Option<&str>,
) -> AppResult<()> {
    let reference = covered(anchor)?;
    let data = AnnotationData {
        v: 0,
        color: Some(color.into()),
        anchor: Some(anchor.clone()),
    };
    conn.execute(
        "UPDATE annotations
         SET passage = ?2, start_key = ?3, end_key = ?4, data = ?5,
             translation_id = COALESCE(?6, translation_id),
             updated_at = ?7, revision = revision + 1
         WHERE id = ?1",
        params![
            id,
            reference.canonical(),
            reference.start_key(),
            reference.end_key(),
            data.to_stored(),
            translation_id,
            now()
        ],
    )?;
    Ok(())
}

fn soft_delete(conn: &Connection, id: &str) -> AppResult<()> {
    let at = now();
    conn.execute(
        "UPDATE annotations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, at],
    )?;
    Ok(())
}

/// Inserts a highlight row. `created_at` is kept when a highlight is split,
/// so both halves read as the original.
fn insert_highlight(
    conn: &Connection,
    color: &str,
    anchor: &StoredAnchor,
    translation_id: Option<&str>,
    created_at: Option<&str>,
) -> AppResult<String> {
    let reference = covered(anchor)?;
    let data = AnnotationData {
        v: 0,
        color: Some(color.into()),
        anchor: Some(anchor.clone()),
    };
    let workspace = workspaces::get_default(conn)?;
    let id = new_id();
    let at = now();
    conn.execute(
        "INSERT INTO annotations
             (id, workspace_id, passage, start_key, end_key, translation_id, kind, content, data,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'highlight', '', ?7, ?8, ?9)",
        params![
            id,
            workspace.id,
            reference.canonical(),
            reference.start_key(),
            reference.end_key(),
            translation_id,
            data.to_stored(),
            created_at.unwrap_or(&at),
            at
        ],
    )?;
    Ok(id)
}

/// Applies a phrase highlight the way a physical highlighter works: the new
/// highlight owns exactly the words it covers, and highlights already on the
/// same wording are made to fit around it.
///
/// Only highlights whose stored verse hashes match the translation's text
/// are touched ("same wording" is decided by hashes, never by translation
/// name or by canonical overlap). Phrase notes, whole-verse highlights and
/// bookmarks are never looked at. The caller supplies the transaction, so
/// either everything below happens or nothing does.
///
/// Order, which is deterministic:
/// 1. Lay the chapter's text on one line and find the highlights shown in it.
/// 2. Grow the new range over same-colour highlights that overlap or touch it
///    (repeatedly) — the final range.
/// 3. Different-colour highlights are cut against the final range: wholly
///    covered ones are soft-deleted, one overlapped at an edge is trimmed,
///    one the range lies inside is split (the original keeps the part before,
///    a new row takes the part after, with the same colour and provenance).
///    Each remaining piece is rebuilt from the stored text.
/// 4. The final range is one highlight: the earliest merged same-colour
///    highlight (extended if needed, the others soft-deleted); else a
///    different-colour highlight on exactly that range, recoloured in place;
///    else a new row. Returns its id.
pub fn highlight_phrase(
    conn: &Connection,
    translation_id: &str,
    color: &str,
    anchor: &StoredAnchor,
) -> AppResult<String> {
    let (ordinal, chapter, _) = split_key(anchor.start.verse);
    let first = verse_key(ordinal, chapter, 0);
    let last = verse_key(ordinal, chapter, 999);
    let texts = verse_texts(conn, translation_id, first, last)?;
    let layout = Layout::new(&texts);
    let unreachable =
        || AppError::Unexpected("a new highlight is not in its chapter's text".into());
    let wanted = layout
        .span(anchor.start, anchor.end)
        .ok_or_else(unreachable)?;

    // Highlights of this chapter that are on screen in this very wording.
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM annotations
         WHERE deleted_at IS NULL AND passage IS NOT NULL AND kind = 'highlight'
           AND start_key <= ?2 AND end_key >= ?1
         ORDER BY created_at, rowid"
    ))?;
    let rows = stmt
        .query_map(params![first, last], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut same: Vec<PhraseHighlight> = Vec::new();
    let mut other: Vec<PhraseHighlight> = Vec::new();
    for raw in rows {
        let data = AnnotationData::read(raw.data.as_deref());
        let Some(stored) = data.anchor else { continue };
        if !wording_matches(&stored, &texts) {
            continue;
        }
        let Some(span) = layout.span(stored.start, stored.end) else {
            continue;
        };
        let item = PhraseHighlight {
            color: data
                .color
                .unwrap_or_else(|| DEFAULT_HIGHLIGHT_COLOR.to_string()),
            anchor: stored,
            span,
            raw,
        };
        if item.color == color {
            same.push(item);
        } else {
            other.push(item);
        }
    }

    // 2. The final range.
    let (range, absorbed) = absorb(wanted, &same.iter().map(|h| h.span).collect::<Vec<_>>());

    // 3. Make the other colours fit around it.
    let mut recolour_in_place: Option<usize> = None;
    for (i, old) in other.iter().enumerate() {
        if !old.span.overlaps(range) {
            continue;
        }
        if old.span == range && absorbed.is_empty() {
            // Exactly the same words: the highlight just changes colour (below).
            recolour_in_place = Some(i);
            continue;
        }
        let (before, after) = remainders(old.span, range);
        let mut pieces = [before, after]
            .into_iter()
            .flatten()
            .filter(|piece| layout.has_visible_text(*piece));
        let name = &old.anchor.translation_short_name;
        match pieces.next() {
            None => soft_delete(conn, &old.raw.id)?,
            Some(keep) => {
                write_anchor(
                    conn,
                    &old.raw.id,
                    &old.color,
                    &rebuild(&layout, &texts, keep, name)?,
                    None,
                )?;
                if let Some(split) = pieces.next() {
                    insert_highlight(
                        conn,
                        &old.color,
                        &rebuild(&layout, &texts, split, name)?,
                        old.raw.translation_id.as_deref(),
                        Some(&old.raw.created_at),
                    )?;
                }
            }
        }
    }

    // 4. The highlight that holds the final range.
    if let Some(&lead) = absorbed.first() {
        let lead = &same[lead];
        for &i in absorbed.iter().skip(1) {
            soft_delete(conn, &same[i].raw.id)?;
        }
        if lead.span != range {
            // Extended: provenance becomes the wording it was extended in.
            let short_name = bibles::get(conn, translation_id)?.short_name;
            let rebuilt = rebuild(&layout, &texts, range, &short_name)?;
            write_anchor(conn, &lead.raw.id, color, &rebuilt, Some(translation_id))?;
        }
        return Ok(lead.raw.id.clone());
    }
    if let Some(i) = recolour_in_place {
        let target = &other[i];
        write_anchor(conn, &target.raw.id, color, &target.anchor, None)?;
        return Ok(target.raw.id.clone());
    }
    insert_highlight(conn, color, anchor, Some(translation_id), None)
}
