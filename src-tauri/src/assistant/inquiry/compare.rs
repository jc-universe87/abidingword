//! What the assistant is shown to compare: the two or three passages the
//! person deliberately put side by side, each checked against its source's
//! stored text, and nothing else (no other authors, no search).

use rusqlite::Connection;

use super::{BlockKind, InquiryInput, Material, Scope};
use crate::error::{AppError, AppResult, UserMessage};

/// The setting a comparison is described with.
pub const SETTING: &str = "Passages the person selected to compare";

pub fn assemble(conn: &Connection, input: &InquiryInput, request: &str) -> AppResult<Material> {
    let Scope::Compare { excerpts, study_id } = &input.scope else {
        return Err(super::not_for_this());
    };
    if !(2..=3).contains(&excerpts.len()) {
        return Err(AppError::Assistant(UserMessage::new(
            "inquiry.compareCount",
            "Choose two or three passages to compare.",
        )));
    }
    for (i, a) in excerpts.iter().enumerate() {
        if excerpts[..i].contains(a) {
            return Err(AppError::Assistant(UserMessage::new(
                "inquiry.compareSame",
                "The same passage was chosen twice. Choose different passages to compare.",
            )));
        }
    }
    let total: usize = excerpts.iter().map(|e| e.quote.chars().count()).sum();
    if total > super::COMPARE_TOTAL_MAX {
        return Err(AppError::Assistant(
            UserMessage::new(
                "inquiry.compareTooLong",
                "Together these passages are too long to compare at once. Choose shorter passages.",
            )
            .with("max", super::COMPARE_TOTAL_MAX),
        ));
    }
    let mut material = Material::new(input.action, SETTING.into(), &input.ui_language);
    for e in excerpts {
        super::source::excerpt_block(conn, &mut material, e, super::COMPARE_EACH_MAX)?;
    }
    if let Some(id) = study_id.as_deref().filter(|s| !s.is_empty()) {
        let ids: Vec<&str> = excerpts.iter().map(|e| e.source_id.as_str()).collect();
        super::source::include_study(conn, &mut material, id, &ids)?;
    }
    if !request.is_empty() {
        material.push(BlockKind::Request, "Your question".into(), request);
    }
    Ok(material)
}
