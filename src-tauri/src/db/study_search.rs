//! Search across the user's studies: titles and purposes, section titles,
//! block text and findings. The index (`study_search`, FTS5) is maintained
//! by database triggers (migration 0003), so it is always in step.

use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::{FindingType, StudySearchHit};
use crate::error::{AppError, AppResult, UserMessage};

const LIMIT: i64 = 100;

/// Marks in snippets: matches are wrapped in these control characters,
/// which never occur in normal text; the interface turns them into bold.
pub const MATCH_START: char = '\u{2}';
pub const MATCH_END: char = '\u{3}';

pub fn search(conn: &Connection, input: &str) -> AppResult<Vec<StudySearchHit>> {
    let Some(query) = crate::db::fts::query(input) else {
        return Err(AppError::InvalidInput(UserMessage::new(
            "search.empty",
            "Type a word or phrase to search for.",
        )));
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
        let place = location(conn, &kind, &item_id)?;
        hits.push(StudySearchHit {
            location: place.text,
            section_key: place.section_key,
            section_title: place.section_title,
            finding_type: place.finding_type,
            study_id,
            study_title,
            project_id,
            kind,
            snippet,
        });
    }
    Ok(hits)
}

#[derive(Default)]
struct Place {
    text: String,
    section_key: Option<String>,
    section_title: Option<String>,
    finding_type: Option<String>,
}

/// Where a match is: English words, and the facts the interface needs to
/// say it in the user's language.
fn location(conn: &Connection, kind: &str, item_id: &str) -> AppResult<Place> {
    Ok(match kind {
        "study" => Place {
            text: "Title or purpose".into(),
            ..Place::default()
        },
        "section" => Place {
            text: "Section title".into(),
            ..Place::default()
        },
        "block" => {
            let section: Option<(Option<String>, String)> = conn
                .query_row(
                    "SELECT s.key, s.title FROM study_blocks b JOIN study_sections s ON s.id = b.section_id WHERE b.id = ?1",
                    [item_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            match section {
                Some((key, title)) => Place {
                    text: title.clone(),
                    section_key: key,
                    section_title: Some(title),
                    finding_type: None,
                },
                None => Place {
                    text: "Study text".into(),
                    ..Place::default()
                },
            }
        }
        _ => {
            let kind: Option<FindingType> = conn
                .query_row("SELECT kind FROM findings WHERE id = ?1", [item_id], |r| {
                    r.get::<_, String>(0)
                })
                .optional()?
                .and_then(|k| FindingType::parse(&k).ok());
            Place {
                text: format!("Finding: {}", kind.map(finding_label).unwrap_or("Finding")),
                finding_type: kind.map(|k| k.as_str().to_string()),
                ..Place::default()
            }
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
