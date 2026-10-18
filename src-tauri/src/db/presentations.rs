//! Presentations (v0.18): how one teaching is delivered. Items follow the
//! teaching live (by naming the part they come from); only the person's own
//! wording for the presentation and their speaker notes are stored here.
//! Nothing in the teaching is ever changed from here.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{findings, new_id, now, teaching};
use crate::domain::validate::{self, BLOCK_MAX_CHARS, TITLE_MAX_CHARS};
use crate::domain::{
    CreatePresentation, CreatePresentationItem, ItemSource, Presentation, PresentationItem,
    PresentationSummary, ProposalLabels, Reorder, TeachingPreparation, UpdatePresentation,
    UpdatePresentationItem, ITEM_KINDS, PREPARATION_FIELDS, PRESENTATION_THEMES, SOURCE_KINDS,
};
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::reference::ScriptureRef;

/// A presentation holds at most this many items.
pub const ITEMS_MAX: usize = 500;
/// A target time is at most ten hours.
pub const TARGET_MINUTES_MAX: u32 = 600;

const COLUMNS: &str = "id, preparation_id, title, theme, translation_id, created_at, updated_at, \
                       revision, target_minutes";
const ITEM_COLUMNS: &str = "id, position, kind, source_kind, source_id, source_field, heading, \
                            body, reference, notes, skipped";

fn from_row(row: &Row) -> rusqlite::Result<Presentation> {
    Ok(Presentation {
        id: row.get(0)?,
        preparation_id: row.get(1)?,
        title: row.get(2)?,
        theme: row.get(3)?,
        translation_id: row.get(4)?,
        target_minutes: row.get(8)?,
        items: Vec::new(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        revision: row.get(7)?,
    })
}

fn item_from_row(row: &Row) -> rusqlite::Result<PresentationItem> {
    let source_kind: Option<String> = row.get(3)?;
    let source_id: Option<String> = row.get(4)?;
    let source = match (source_kind, source_id) {
        (Some(kind), Some(id)) => Some(ItemSource {
            kind,
            id,
            field: row.get(5)?,
        }),
        _ => None,
    };
    Ok(PresentationItem {
        id: row.get(0)?,
        position: row.get(1)?,
        kind: row.get(2)?,
        source,
        heading: row.get(6)?,
        body: row.get(7)?,
        reference: row.get(8)?,
        notes: row.get(9)?,
        skipped: row.get::<_, i64>(10)? != 0,
    })
}

fn invalid(code: &'static str, text: &str) -> AppError {
    AppError::InvalidInput(UserMessage::new(code, text))
}

fn choice(value: &str, allowed: &[&str], what: &str) -> AppResult<String> {
    let value = value.trim();
    if allowed.contains(&value) {
        return Ok(value.to_string());
    }
    Err(AppError::InvalidInput(
        UserMessage::new("invalidChoice", format!("“{value}” is not a valid {what}."))
            .with("value", value),
    ))
}

fn heading_text(value: &str) -> AppResult<String> {
    if value.trim().chars().count() > TITLE_MAX_CHARS {
        return Err(invalid(
            "presentation.tooLong",
            "This heading is too long for a slide.",
        ));
    }
    Ok(value.trim().to_string())
}

fn long_text(value: &str) -> AppResult<String> {
    if value.chars().count() > BLOCK_MAX_CHARS {
        return Err(invalid(
            "presentation.tooLong",
            "This text is too long to save.",
        ));
    }
    Ok(value.to_string())
}

fn reference(value: &str) -> AppResult<String> {
    Ok(ScriptureRef::from_canonical(value.trim())?.canonical())
}

// ---------------------------------------------------------------------------
// Presentations
// ---------------------------------------------------------------------------

/// A teaching's presentations, in the order they were made.
pub fn list(conn: &Connection, preparation_id: &str) -> AppResult<Vec<PresentationSummary>> {
    teaching::get(conn, preparation_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, preparation_id, title, theme, updated_at FROM presentations
         WHERE preparation_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at, rowid",
    )?;
    let rows = stmt.query_map([preparation_id], |row| {
        Ok(PresentationSummary {
            id: row.get(0)?,
            preparation_id: row.get(1)?,
            title: row.get(2)?,
            theme: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn row(conn: &Connection, id: &str) -> AppResult<Presentation> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM presentations WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("presentation", id))
}

fn items_for(conn: &Connection, id: &str) -> AppResult<Vec<PresentationItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ITEM_COLUMNS} FROM presentation_items
         WHERE presentation_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at, rowid"
    ))?;
    let rows = stmt.query_map([id], item_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// A presentation with its items in order. The teaching it belongs to must
/// still be there.
pub fn get(conn: &Connection, id: &str) -> AppResult<Presentation> {
    let mut presentation = row(conn, id)?;
    teaching::get(conn, &presentation.preparation_id)?;
    presentation.items = items_for(conn, id)?;
    Ok(presentation)
}

/// What a new item is made of before it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    pub kind: String,
    pub source: Option<ItemSource>,
    pub heading: Option<String>,
    pub skipped: bool,
}

fn source(kind: &str, id: &str, field: Option<&str>) -> Option<ItemSource> {
    Some(ItemSource {
        kind: kind.to_string(),
        id: id.to_string(),
        field: field.map(str::to_string),
    })
}

fn has_text(value: Option<&str>) -> bool {
    value.is_some_and(|v| !v.trim().is_empty())
}

/// A first presentation made from the teaching by fixed rules (no AI): the
/// title slide; the teaching's own passages; the central message; for each
/// point or step, its slide (a question for a question or a Bible Study
/// question, an activity for an activity, otherwise a heading), then its
/// passages and kept images; the conclusion. The introduction and the
/// conclusion are spoken: their text is the speaker's, under a heading in
/// the person's language. The person then keeps, leaves out or changes any of it.
pub fn propose(prep: &TeachingPreparation, labels: &ProposalLabels) -> Vec<NewItem> {
    let item = |kind: &str, source| NewItem {
        kind: kind.to_string(),
        source,
        heading: None,
        skipped: false,
    };
    let mut items = vec![item(
        "title",
        source("preparation", &prep.id, Some("title")),
    )];
    if !prep.introduction.trim().is_empty() {
        items.push(NewItem {
            heading: Some(labels.introduction.trim().to_string()).filter(|l| !l.is_empty()),
            ..item(
                "heading",
                source("preparation", &prep.id, Some("introduction")),
            )
        });
    }
    // The title slide shows the main passage as its subtitle; the passage
    // itself comes straight after.
    for passage in prep.passages.iter().filter(|p| p.point_id.is_none()) {
        items.push(item("scripture", source("passage", &passage.id, None)));
    }
    if has_text(prep.central_message.as_deref()) {
        items.push(item(
            "text",
            source("preparation", &prep.id, Some("central_message")),
        ));
    }
    let questions = prep.kind.as_deref() == Some("bible_study");
    for point in &prep.points {
        let step = point.kind.as_deref();
        let images: Vec<_> = prep
            .materials
            .iter()
            .filter(|m| m.point_id.as_deref() == Some(&point.id) && m.kind == "image")
            .collect();
        let passages: Vec<_> = prep
            .passages
            .iter()
            .filter(|p| p.point_id.as_deref() == Some(&point.id))
            .collect();
        let kind = match step {
            Some("question") => "question",
            Some("activity") => "activity",
            _ if questions && step.is_none() => "question",
            _ => "heading",
        };
        // A Scripture step or an image step is shown by its passage or image
        // when it has one.
        let shown_by_content = (step == Some("scripture") && !passages.is_empty())
            || (step == Some("image") && !images.is_empty());
        if !shown_by_content {
            items.push(item(kind, source("point", &point.id, None)));
        }
        for passage in passages {
            items.push(item("scripture", source("passage", &passage.id, None)));
        }
        for image in images {
            items.push(item("image", source("material", &image.id, None)));
        }
    }
    if !prep.conclusion.trim().is_empty() {
        items.push(NewItem {
            heading: Some(labels.conclusion.trim().to_string()).filter(|l| !l.is_empty()),
            ..item(
                "heading",
                source("preparation", &prep.id, Some("conclusion")),
            )
        });
    }
    items.truncate(ITEMS_MAX);
    items
}

pub fn create(conn: &Connection, input: &CreatePresentation) -> AppResult<Presentation> {
    let prep = teaching::get(conn, &input.preparation_id)?;
    let title = match input.title.as_deref().filter(|t| !t.trim().is_empty()) {
        Some(t) => validate::title(t, "presentation")?,
        None => prep.title.clone(),
    };
    let items = if input.propose {
        propose(&prep, &input.labels)
    } else {
        vec![NewItem {
            kind: "title".to_string(),
            source: source("preparation", &prep.id, Some("title")),
            heading: None,
            skipped: false,
        }]
    };
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM presentations
         WHERE preparation_id = ?1 AND deleted_at IS NULL",
        [&prep.id],
        |r| r.get(0),
    )?;
    let id = new_id();
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO presentations (id, preparation_id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, prep.id, title, position, now],
    )?;
    for (index, item) in items.iter().enumerate() {
        insert_item(&tx, &id, index as i64, item, &now)?;
    }
    tx.commit()?;
    get(conn, &id)
}

fn insert_item(
    conn: &Connection,
    presentation_id: &str,
    position: i64,
    item: &NewItem,
    now: &str,
) -> AppResult<String> {
    let id = new_id();
    let (kind, source_id, field) = match &item.source {
        Some(s) => (Some(&s.kind), Some(&s.id), s.field.as_ref()),
        None => (None, None, None),
    };
    conn.execute(
        "INSERT INTO presentation_items (id, presentation_id, position, kind, source_kind,
             source_id, source_field, heading, skipped, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            presentation_id,
            position,
            item.kind,
            kind,
            source_id,
            field,
            item.heading,
            i64::from(item.skipped),
            now
        ],
    )?;
    Ok(id)
}

pub fn update(conn: &Connection, input: &UpdatePresentation) -> AppResult<Presentation> {
    let current = row(conn, &input.id)?;
    let title = match &input.title {
        Some(t) => validate::title(t, "presentation")?,
        None => current.title,
    };
    let theme = match &input.theme {
        Some(t) => choice(t, PRESENTATION_THEMES, "background")?,
        None => current.theme,
    };
    let translation_id = match input.translation_id.as_deref().map(str::trim) {
        Some("") => None,
        Some(t) => {
            crate::db::bibles::get(conn, t)?;
            Some(t.to_string())
        }
        None => current.translation_id,
    };
    let target_minutes = match input.target_minutes {
        Some(0) => None,
        Some(m) if m <= TARGET_MINUTES_MAX => Some(m),
        Some(_) => {
            return Err(invalid(
                "presentation.targetTooLong",
                "The target time can be at most ten hours.",
            ))
        }
        None => current.target_minutes,
    };
    conn.execute(
        "UPDATE presentations SET title = ?2, theme = ?3, translation_id = ?4, updated_at = ?5,
             target_minutes = ?6, revision = revision + 1
         WHERE id = ?1",
        params![
            input.id,
            title,
            theme,
            translation_id,
            now(),
            target_minutes
        ],
    )?;
    get(conn, &input.id)
}

/// Soft delete. The teaching is untouched.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    row(conn, id)?;
    let now = now();
    conn.execute(
        "UPDATE presentations SET deleted_at = ?2, updated_at = ?2, revision = revision + 1
         WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

fn touch(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE presentations SET updated_at = ?2, revision = revision + 1 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/// The presentation a live item belongs to.
fn item_owner(conn: &Connection, item_id: &str) -> AppResult<String> {
    conn.query_row(
        "SELECT presentation_id FROM presentation_items WHERE id = ?1 AND deleted_at IS NULL",
        [item_id],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("slide", item_id))
}

/// A source must be a part of this presentation's own teaching.
fn check_source(
    conn: &Connection,
    prep: &TeachingPreparation,
    source: &ItemSource,
) -> AppResult<ItemSource> {
    let kind = choice(&source.kind, SOURCE_KINDS, "part of the teaching")?;
    let id = source.id.trim();
    let other = || {
        invalid(
            "presentation.otherTeaching",
            "That part belongs to another teaching.",
        )
    };
    let mut field = None;
    match kind.as_str() {
        "preparation" => {
            if id != prep.id {
                return Err(other());
            }
            field = Some(choice(
                source.field.as_deref().unwrap_or("title"),
                PREPARATION_FIELDS,
                "part of the teaching",
            )?);
        }
        "point" if !prep.points.iter().any(|p| p.id == id) => return Err(other()),
        "passage" if !prep.passages.iter().any(|p| p.id == id) => return Err(other()),
        "material" if !prep.materials.iter().any(|m| m.id == id) => return Err(other()),
        "finding" if findings::get(conn, id)?.study_id != prep.study_id => return Err(other()),
        _ => {}
    }
    Ok(ItemSource {
        kind,
        id: id.to_string(),
        field,
    })
}

fn renumber(conn: &Connection, ids: &[String], now: &str) -> AppResult<()> {
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE presentation_items SET position = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, index as i64, now],
        )?;
    }
    Ok(())
}

pub fn create_item(conn: &Connection, input: &CreatePresentationItem) -> AppResult<Presentation> {
    let presentation = get(conn, &input.presentation_id)?;
    if presentation.items.len() >= ITEMS_MAX {
        return Err(invalid(
            "presentation.tooMany",
            "This presentation has as many slides as it can hold.",
        ));
    }
    let prep = teaching::get(conn, &presentation.preparation_id)?;
    let kind = choice(&input.kind, ITEM_KINDS, "kind of slide")?;
    let source = input
        .source
        .as_ref()
        .map(|s| check_source(conn, &prep, s))
        .transpose()?;
    let heading = input.heading.as_deref().map(heading_text).transpose()?;
    let body = input.body.as_deref().map(long_text).transpose()?;
    let reference = input
        .reference
        .as_deref()
        .filter(|r| !r.trim().is_empty())
        .map(reference)
        .transpose()?;
    let mut order: Vec<String> = presentation.items.iter().map(|i| i.id.clone()).collect();
    let at = match input.after_item_id.as_deref().filter(|i| !i.is_empty()) {
        Some(after) => order
            .iter()
            .position(|id| id == after)
            .map(|i| i + 1)
            .ok_or_else(|| AppError::not_found("slide", after))?,
        None => order.len(),
    };
    let now = now();
    let tx = conn.unchecked_transaction()?;
    let id = insert_item(
        &tx,
        &presentation.id,
        at as i64,
        &NewItem {
            kind,
            source,
            heading,
            skipped: false,
        },
        &now,
    )?;
    tx.execute(
        "UPDATE presentation_items SET body = ?2, reference = ?3 WHERE id = ?1",
        params![id, body, reference],
    )?;
    order.insert(at, id);
    renumber(&tx, &order, &now)?;
    touch(&tx, &presentation.id, &now)?;
    tx.commit()?;
    get(conn, &presentation.id)
}

pub fn update_item(conn: &Connection, input: &UpdatePresentationItem) -> AppResult<Presentation> {
    let presentation = get(conn, &item_owner(conn, &input.id)?)?;
    let current = presentation
        .items
        .iter()
        .find(|i| i.id == input.id)
        .cloned()
        .ok_or_else(|| AppError::not_found("slide", &input.id))?;
    let kind = match &input.kind {
        Some(k) => choice(k, ITEM_KINDS, "kind of slide")?,
        None => current.kind,
    };
    let heading = if input.follow_heading {
        None
    } else {
        match &input.heading {
            Some(h) => Some(heading_text(h)?),
            None => current.heading,
        }
    };
    let body = if input.follow_body {
        None
    } else {
        match &input.body {
            Some(b) => Some(long_text(b)?),
            None => current.body,
        }
    };
    let reference = if input.follow_reference {
        None
    } else {
        match input.reference.as_deref().map(str::trim) {
            Some("") => None,
            Some(r) => Some(self::reference(r)?),
            None => current.reference,
        }
    };
    let notes = match &input.notes {
        Some(n) => long_text(n)?,
        None => current.notes,
    };
    let skipped = input.skipped.unwrap_or(current.skipped);
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE presentation_items SET kind = ?2, heading = ?3, body = ?4, reference = ?5,
             notes = ?6, skipped = ?7, updated_at = ?8
         WHERE id = ?1",
        params![
            input.id,
            kind,
            heading,
            body,
            reference,
            notes,
            i64::from(skipped),
            now
        ],
    )?;
    touch(&tx, &presentation.id, &now)?;
    tx.commit()?;
    get(conn, &presentation.id)
}

/// Removes a slide from the presentation. The teaching is untouched.
pub fn delete_item(conn: &Connection, item_id: &str) -> AppResult<Presentation> {
    let presentation = get(conn, &item_owner(conn, item_id)?)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE presentation_items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![item_id, now],
    )?;
    let order: Vec<String> = items_for(&tx, &presentation.id)?
        .into_iter()
        .map(|i| i.id)
        .collect();
    renumber(&tx, &order, &now)?;
    touch(&tx, &presentation.id, &now)?;
    tx.commit()?;
    get(conn, &presentation.id)
}

/// Puts the items in the given order; it must name exactly the live items.
pub fn reorder_items(conn: &Connection, input: &Reorder) -> AppResult<Presentation> {
    let presentation = get(conn, &input.parent_id)?;
    let current: Vec<String> = presentation.items.iter().map(|i| i.id.clone()).collect();
    crate::db::check_same_members(&current, &input.ids, "slides")?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    renumber(&tx, &input.ids, &now)?;
    touch(&tx, &presentation.id, &now)?;
    tx.commit()?;
    get(conn, &presentation.id)
}
