//! What the assistant is shown for help in a Bible Study: the study's main
//! passage in the person's Bible, the writing or note in focus, the other
//! notes of that part (with quotations kept in them, attributed), and the
//! person's question. Never another study, another part's writing, the
//! library, or anything from settings.

use rusqlite::Connection;

use super::{cut, BlockKind, Inquiry, InquiryInput, Material, Scope};
use crate::assistant::context::write_first;
use crate::db::{
    bibles, blocks, findings, sections, settings as app_settings, studies, study_passages,
};
use crate::domain::Finding;
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::reference::ScriptureRef;

fn ask_for(key: &'static str, text: &str) -> AppError {
    AppError::Assistant(UserMessage::new(key, text))
}

/// The study's main passage, in the study's Bible or the person's default
/// one, when it is installed here.
pub(super) fn scripture(
    conn: &Connection,
    study: &crate::domain::Study,
    material: &mut Material,
) -> AppResult<()> {
    let Some(primary) = study_passages::primary(conn, &study.id)? else {
        return Ok(());
    };
    let reference = ScriptureRef::from_canonical(&primary.reference.canonical)?;
    let translation = study
        .details
        .translation_id
        .clone()
        .or(app_settings::get(conn)?.scripture_translation_id)
        .and_then(|id| bibles::get(conn, &id).ok());
    let mut text = None;
    if let Some(t) = &translation {
        if let Ok(passage) = bibles::passage(conn, &t.id, &reference) {
            let joined = passage
                .verses
                .iter()
                .map(|v| format!("{}:{} {}", v.chapter, v.verse, v.text))
                .collect::<Vec<_>>()
                .join(" ");
            if !joined.trim().is_empty() {
                text = Some(cut(&joined, super::SCRIPTURE_MAX));
            }
        }
    }
    let display = reference.display();
    let (label, body, short) = match (&text, &translation) {
        (Some(body), Some(t)) => (
            format!("{display} ({})", t.short_name),
            body.clone(),
            Some(t.short_name.clone()),
        ),
        _ => (
            display.clone(),
            "(The Bible text is not installed on this computer: only the reference is given.)"
                .to_string(),
            None,
        ),
    };
    let block = material.push(BlockKind::Scripture, label, &body);
    block.reference = Some(reference.to_dto());
    block.translation = short;
    Ok(())
}

/// A note as the assistant reads it, with the quotations kept in it.
pub(super) fn note(material: &mut Material, finding: &Finding, label: String, quotes: &mut usize) {
    material.push(
        BlockKind::Note,
        label,
        &cut(&finding.content, super::NOTE_MAX),
    );
    let note_id = material
        .blocks
        .last()
        .map(|b| b.id.clone())
        .unwrap_or_default();
    for c in &finding.sources {
        if *quotes >= super::QUOTES_MAX {
            break;
        }
        let Some(quote) = c.quote.as_deref().map(str::trim).filter(|q| !q.is_empty()) else {
            continue;
        };
        let mut citation = c.title.clone();
        if let Some(author) = c.author.as_deref().filter(|a| !a.is_empty()) {
            citation = format!("{author}, {citation}");
        }
        if let Some(locator) = c.locator.as_deref().filter(|l| !l.is_empty()) {
            citation = format!("{citation}, {locator}");
        }
        material.push(
            BlockKind::Quote,
            format!(
                "Quotation from {}, kept in note {note_id}",
                cut(&citation, 200)
            ),
            &cut(quote, super::QUOTE_MAX),
        );
        *quotes += 1;
    }
}

pub fn kind_label(f: &Finding) -> String {
    f.finding_type.as_str().replace('_', " ")
}

pub fn assemble(conn: &Connection, input: &InquiryInput, request: &str) -> AppResult<Material> {
    let Scope::Study {
        study_id,
        section_id,
        block_id,
        text,
        selected,
        finding_id,
        writing,
    } = &input.scope
    else {
        return Err(super::not_for_this());
    };
    let action = input.action;
    let study = studies::get(conn, study_id)?;
    let section = match section_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let section = sections::get(conn, id)?;
            if section.study_id != study.id {
                return Err(AppError::not_found("study section", id));
            }
            Some(section)
        }
        None => None,
    };
    let part = section
        .as_ref()
        .map(|s| format!(" — part “{}”", cut(&s.title, 80)))
        .unwrap_or_default();
    let mut material = Material::new(
        action,
        format!(
            "Bible Study “{}” ({}){part}",
            cut(&study.title, 120),
            study.study_type.as_str().replace('_', " ")
        ),
        &input.ui_language,
    );
    scripture(conn, &study, &mut material)?;

    // The writing in focus, as it is on screen.
    let text = text.trim();
    let selected = selected.trim();
    // Selected words are words of one piece of writing, named.
    if !selected.is_empty() && block_id.as_deref().is_none_or(str::is_empty) {
        return Err(ask_for(
            "inquiry.selectionChanged",
            "The selected words are no longer in the text. Select them again.",
        ));
    }
    if let Some(id) = block_id.as_deref().filter(|b| !b.is_empty()) {
        let block = blocks::get(conn, id)?;
        if section.as_ref().is_none_or(|s| s.id != block.section_id) {
            return Err(AppError::not_found("study block", id));
        }
        if text.chars().count() > super::WRITING_MAX {
            return Err(AppError::Assistant(
                UserMessage::new(
                    "assistant.textTooLong",
                    "This text is too long to send at once. Select a part of it and try again.",
                )
                .with("max", super::WRITING_MAX),
            ));
        }
        if !selected.is_empty() {
            if !text.contains(selected) {
                return Err(ask_for(
                    "inquiry.selectionChanged",
                    "The selected words are no longer in the text. Select them again.",
                ));
            }
            material.push(
                BlockKind::Writing,
                format!("Words you selected in your writing{part}"),
                selected,
            );
            if selected != text {
                material.push(
                    BlockKind::Writing,
                    format!("Your writing they are in{part}"),
                    text,
                );
            }
            material.original = Some(selected.to_string());
        } else if !text.is_empty() {
            material.push(BlockKind::Writing, format!("Your writing{part}"), text);
            material.original = Some(text.to_string());
        }
    }

    let notes = findings::list(conn, &study.id)?;
    let mut quotes = 0;
    let focus_note = match finding_id.as_deref().filter(|f| !f.is_empty()) {
        Some(id) => {
            let finding = notes
                .iter()
                .find(|f| f.id == id)
                .ok_or_else(|| AppError::not_found("finding", id))?;
            note(
                &mut material,
                finding,
                format!("Your note ({}){part}", kind_label(finding)),
                &mut quotes,
            );
            Some(id)
        }
        None => None,
    };

    // A part asked about as a whole: its writing from the study.
    if block_id.is_none() && focus_note.is_none() {
        if let Some(section) = &section {
            let mut used = 0;
            let parts = blocks::list_for_section(conn, &section.id)?;
            if let Some(stray) = writing
                .iter()
                .find(|w| !parts.iter().any(|b| b.id == w.block_id))
            {
                return Err(AppError::not_found("study block", &stray.block_id));
            }
            for block in parts {
                // What is on screen, when given; else what is saved.
                let shown = writing.iter().find(|w| w.block_id == block.id);
                let piece = shown
                    .map_or(block.content.as_str(), |w| w.text.as_str())
                    .trim();
                if piece.is_empty() || used >= super::WRITING_MAX {
                    continue;
                }
                let piece = cut(piece, super::WRITING_MAX - used);
                used += piece.chars().count();
                material.push(BlockKind::Writing, format!("Your writing{part}"), &piece);
            }
        }
    }

    // The part's other notes, for context.
    if let Some(section) = &section {
        for f in notes
            .iter()
            .filter(|f| f.section_id.as_deref() == Some(section.id.as_str()))
            .filter(|f| Some(f.id.as_str()) != focus_note && !f.content.trim().is_empty())
        {
            if material
                .blocks
                .iter()
                .filter(|b| b.kind == BlockKind::Note)
                .count()
                >= super::NOTES_MAX
            {
                break;
            }
            note(
                &mut material,
                f,
                format!("Another of your notes in this part ({})", kind_label(f)),
                &mut quotes,
            );
        }
    }

    if !request.is_empty() {
        material.push(BlockKind::Request, "Your question".into(), request);
    }

    // Grounded in the person's material, or not at all.
    let has = |k: BlockKind| material.blocks.iter().any(|b| b.kind == k);
    let has_text = material
        .blocks
        .iter()
        .any(|b| b.kind == BlockKind::Scripture && b.translation.is_some());
    match action {
        a if a.is_wording() => {
            if material.original.as_deref().is_none_or(str::is_empty) {
                return Err(write_first());
            }
        }
        Inquiry::Expression => {
            if selected.is_empty() {
                return Err(ask_for(
                    "inquiry.selectWords",
                    "Select the words you would like to understand first.",
                ));
            }
        }
        Inquiry::Unresolved => {
            if focus_note.is_none() {
                return Err(ask_for(
                    "inquiry.chooseNote",
                    "Choose the question you recorded.",
                ));
            }
        }
        Inquiry::Follows | Inquiry::Overlooked | Inquiry::Assumptions => {
            if !has(BlockKind::Writing) && focus_note.is_none() {
                return Err(write_first());
            }
            if !has(BlockKind::Scripture) {
                return Err(no_passage());
            }
            // Checked against the words of the text, not only its reference.
            if !has_text {
                return Err(no_bible_text());
            }
        }
        Inquiry::Understand | Inquiry::Context | Inquiry::Readings | Inquiry::Related => {
            if !has(BlockKind::Scripture) {
                return Err(no_passage());
            }
            if action == Inquiry::Understand && !has_text {
                return Err(no_bible_text());
            }
        }
        _ => {
            if !has(BlockKind::Scripture) && !has(BlockKind::Writing) && !has(BlockKind::Note) {
                return Err(no_passage());
            }
        }
    }
    Ok(material)
}

fn no_bible_text() -> AppError {
    ask_for(
        "inquiry.noBibleText",
        "The text of this passage is not installed. Add a Bible in Settings, or choose one for this study.",
    )
}

fn no_passage() -> AppError {
    ask_for(
        "inquiry.noPassage",
        "Choose the passage of this Bible Study first: the help starts from the text.",
    )
}
