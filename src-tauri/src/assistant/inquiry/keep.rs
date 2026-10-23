//! Keeping help as a note (v0.20). Only what the person accepted, in the
//! words they accepted (they may have changed them), becomes a note in their
//! study. It is marked with the assistant's name, and cites each source
//! passage it rests on: checked against the source's stored text again now,
//! so a citation can never point at words that are not there.

use rusqlite::Connection;
use serde::Deserialize;

use super::ExcerptInput;
use crate::db::findings;
use crate::domain::{CreateFinding, Finding, FindingType};
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::CitedPassage;

/// The most source passages one kept note cites.
pub const CITATIONS_MAX: usize = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepInsight {
    pub study_id: String,
    #[serde(default)]
    pub section_id: Option<String>,
    pub finding_type: FindingType,
    /// The note's words, as the person accepted them.
    pub content: String,
    /// The assistant's name, as the answer gave it.
    pub assistant: String,
    /// Source passages the note rests on.
    #[serde(default)]
    pub citations: Vec<ExcerptInput>,
}

pub fn keep(conn: &Connection, input: &KeepInsight) -> AppResult<Finding> {
    if input.citations.len() > CITATIONS_MAX {
        return Err(AppError::InvalidInput(UserMessage::new(
            "inquiry.tooManyCitations",
            "A note can cite at most three passages.",
        )));
    }
    let cited: Vec<CitedPassage> = input
        .citations
        .iter()
        .map(|c| CitedPassage {
            source_id: Some(c.source_id.clone()),
            start: Some(c.start.clone()),
            end: Some(c.end.clone()),
            quote: Some(c.quote.clone()),
            ..Default::default()
        })
        .collect();
    findings::create_assisted(
        conn,
        &CreateFinding {
            study_id: input.study_id.clone(),
            finding_type: input.finding_type,
            content: Some(input.content.clone()),
            section_id: input.section_id.clone(),
            passage: None,
        },
        &input.assistant,
        &cited,
    )
}
