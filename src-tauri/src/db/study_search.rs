//! Search across the user's studies: titles and purposes, section titles,
//! block text and findings. The index (`study_search`, FTS5) is maintained
//! by database triggers (migration 0003), so it is always in step.

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::{FindingType, StudySearchHit};
use crate::error::{AppError, AppResult};

const LIMIT: i64 = 100;

/// Marks in snippets: matches are wrapped in these control characters,
/// which never occur in normal text; the interface turns them into bold.
pub const MATCH_START: char = '\u{2}';
pub const MATCH_END: char = '\u{3}';

pub fn search(conn: &Connection, input: &str) -> AppResult<Vec<StudySearchHit>> {
    let Some(query) = crate::db::fts::query(input) else {
        return Err(AppError::InvalidInput(
            "Type a word or phrase to search for.".into(),
        ));
    };
    let mut stmt = conn.prepare(
        "SELECT i.kind, i.item_id, s.id, s.title, s.project_id,
                snippet(study_search, 0, char(2), char(3), '…', 16)
         FROM study_search
         JOIN study_search_items i ON i.id = study_search.rowid
         JOIN studies s ON s.id = i.study_id AND s.deleted_at IS NULL
         JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
         WHERE study_search MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, LIMIT], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
        ))
    })?;
    let mut hits = Vec::new();
    for row in rows {
        let (kind, item_id, study_id, study_title, project_id, snippet) = row?;
        hits.push(StudySearchHit {
            location: location(conn, &kind, &item_id)?,
            study_id,
            study_title,
            project_id,
            kind,
            snippet,
        });
    }
    Ok(hits)
}

/// Where a match is, in plain words.
fn location(conn: &Connection, kind: &str, item_id: &str) -> AppResult<String> {
    Ok(match kind {
        "study" => "Title or purpose".into(),
        "section" => "Section title".into(),
        "block" => conn
            .query_row(
                "SELECT s.title FROM study_blocks b JOIN study_sections s ON s.id = b.section_id WHERE b.id = ?1",
                [item_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| "Study text".into()),
        _ => {
            let kind: Option<String> = conn
                .query_row("SELECT kind FROM findings WHERE id = ?1", [item_id], |r| r.get(0))
                .optional()?;
            let label = kind
                .and_then(|k| FindingType::parse(&k).ok())
                .map(finding_label)
                .unwrap_or("Finding");
            format!("Finding: {label}")
        }
    })
}

pub fn finding_label(kind: FindingType) -> &'static str {
    match kind {
        FindingType::Observation => "Observation",
        FindingType::Interpretation => "Interpretation",
        FindingType::Question => "Question",
        FindingType::Quotation => "Quotation",
        FindingType::Doctrine => "Doctrine",
        FindingType::Application => "Application",
        FindingType::Illustration => "Illustration",
        FindingType::TeachingIdea => "Teaching idea",
        FindingType::UnresolvedIssue => "Unresolved issue",
        FindingType::Conclusion => "Conclusion",
    }
}
