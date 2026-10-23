//! What the assistant is shown for help with a library source: the words the
//! person selected, checked against the source's stored text, with the
//! source's title, author and a place named from its stored paragraphs.
//! Never the rest of the book, never what a model may remember of it. A
//! study is added only when the person chose to include it.

use rusqlite::Connection;

use super::{cut, BlockKind, ExcerptInput, Inquiry, InquiryInput, Material, Scope, SourcePlace};
use crate::db::{findings, library, source_annotations, studies};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::annotations::StoredSegment;

pub fn no_text() -> AppError {
    AppError::Assistant(UserMessage::new(
        "inquiry.noSourceText",
        "This source has no text that can be read here (for example, a scanned PDF). The assistant works only from a source's text, so it cannot help with this one.",
    ))
}

fn too_long(max: usize) -> AppError {
    AppError::Assistant(
        UserMessage::new(
            "inquiry.excerptTooLong",
            "This passage is too long to send at once. Select a shorter passage.",
        )
        .with("max", max),
    )
}

/// "Chapter 4 › Grace · p. 52 · paragraphs 12–16", from stored data only.
pub fn location(segments: &[StoredSegment]) -> String {
    let (Some(first), Some(last)) = (segments.first(), segments.last()) else {
        return String::new();
    };
    let mut parts = Vec::new();
    if let Some(path) = first
        .section_path
        .as_deref()
        .filter(|p| !p.trim().is_empty())
    {
        parts.push(path.trim().to_string());
    }
    let page_label = |s: &StoredSegment| {
        s.locator
            .as_deref()
            .filter(|l| l.starts_with("p. "))
            .map(|l| l[3..].to_string())
            .or(s.page_number.map(|p| p.to_string()))
    };
    match (page_label(first), page_label(last)) {
        (Some(a), Some(b)) if a != b => parts.push(format!("pp. {a}–{b}")),
        (Some(a), _) => parts.push(format!("p. {a}")),
        _ => {}
    }
    let (a, b) = (first.position + 1, last.position + 1);
    parts.push(if a == b {
        format!("paragraph {a}")
    } else {
        format!("paragraphs {a}–{b}")
    });
    parts.join(" · ")
}

/// One selected passage as a source block, within `max` characters.
pub(super) fn excerpt_block(
    conn: &Connection,
    material: &mut Material,
    input: &ExcerptInput,
    max: usize,
) -> AppResult<()> {
    let source = library::get(conn, &input.source_id)?;
    if source.segment_count == 0 || source.extraction_status.as_deref() == Some("ocr_required") {
        return Err(no_text());
    }
    if input.quote.chars().count() > max {
        return Err(too_long(max));
    }
    let excerpt = source_annotations::excerpt(
        conn,
        &input.source_id,
        &input.start,
        &input.end,
        &input.quote,
    )?;
    let location = location(&excerpt.segments);
    let mut name = format!("“{}”", cut(&source.title, 160));
    if let Some(author) = source.author.as_deref().filter(|a| !a.trim().is_empty()) {
        name = format!("{name} by {}", cut(author, 120));
    }
    let text = excerpt.text.clone();
    let block = material.push(BlockKind::Source, format!("{name} — {location}"), &text);
    block.source = Some(SourcePlace {
        source_id: source.id.clone(),
        title: source.title.clone(),
        author: source.author.clone(),
        location,
        excerpt,
    });
    Ok(())
}

/// The study the person chose to include: its main passage and up to six
/// notes (those citing the given sources first).
pub(super) fn include_study(
    conn: &Connection,
    material: &mut Material,
    study_id: &str,
    sources: &[&str],
) -> AppResult<()> {
    let study = studies::get(conn, study_id)?;
    super::study::scripture(conn, &study, material)?;
    let mut notes = findings::list(conn, &study.id)?;
    notes.retain(|f| !f.content.trim().is_empty());
    notes.sort_by_key(|f| {
        !f.sources
            .iter()
            .any(|c| c.source_id.as_deref().is_some_and(|s| sources.contains(&s)))
    });
    let mut quotes = 0;
    for f in notes.iter().take(6) {
        super::study::note(
            material,
            f,
            format!(
                "Your note ({}) in your Bible Study “{}”",
                super::study::kind_label(f),
                cut(&study.title, 80)
            ),
            &mut quotes,
        );
    }
    Ok(())
}

pub fn assemble(conn: &Connection, input: &InquiryInput, request: &str) -> AppResult<Material> {
    let Scope::Source { excerpt, study_id } = &input.scope else {
        return Err(super::not_for_this());
    };
    let mut material = Material::new(
        input.action,
        "A passage of a library source".into(),
        &input.ui_language,
    );
    excerpt_block(conn, &mut material, excerpt, super::EXCERPT_MAX)?;
    let study_id = study_id.as_deref().filter(|s| !s.is_empty());
    match study_id {
        Some(id) => include_study(conn, &mut material, id, &[excerpt.source_id.as_str()])?,
        None if input.action == Inquiry::RelateStudy => {
            return Err(AppError::Assistant(UserMessage::new(
                "inquiry.chooseStudy",
                "Include a Bible Study to relate this passage to.",
            )))
        }
        None => {}
    }
    if !request.is_empty() {
        material.push(BlockKind::Request, "Your question".into(), request);
    }
    Ok(material)
}
