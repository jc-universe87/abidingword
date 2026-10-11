//! Refreshing the text of imported EPUBs from their managed copies when the
//! way text is extracted has improved (v0.13.1).
//!
//! The Reading view shows the text stored at import. Books imported by an
//! earlier version keep that version's text: before v0.13 only a dozen
//! character references were decoded (`&dagger;` stayed literal), and before
//! v0.13.1 an `&` that did not begin a complete reference ("Q&A") ended the
//! chapter there. The original file is kept, so the text is extracted again and
//! the stored segments are brought up to date **in place**: a segment whose
//! paragraph is still there keeps its id (citations keep pointing at it),
//! paragraphs that were missing are added, and the passage index is rebuilt.
//! Nothing is guessed: stored text is never decoded a second time.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{library, new_id, now};
use crate::error::AppResult;
use crate::library::adapters::epub::{c1_as_windows_1252, decode_references_once, EpubImporter};
use crate::library::adapters::{NewSegment, SourceImportAdapter};
use crate::library::original;

/// How text is extracted from imported files. Bumped when a refresh is due.
///
/// * 1 – before v0.13.1.
/// * 2 – every HTML character reference decoded once; a stray `&` kept as text.
pub const EXTRACTION_VERSION: i64 = 2;

const SETTING: &str = "library.extractionVersion";

/// The largest file read again (the import limit).
const MAX_FILE: u64 = 200 * 1024 * 1024;

/// How far ahead a paragraph is looked for in the new text (paragraphs that were
/// lost after a stray `&` are added between the ones that stayed).
const WINDOW: usize = 400;

/// What [`ensure_extracted_text`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TextRefreshReport {
    pub checked: usize,
    pub updated: usize,
    pub failed: usize,
}

/// Brings the stored text of every imported EPUB up to [`EXTRACTION_VERSION`],
/// once. A source that cannot be read again (its file missing, or no longer
/// readable) is logged and left as it was; the run is recorded as done only
/// when no source failed, so a failure is tried again at the next start.
pub fn ensure_extracted_text(
    conn: &Connection,
    sources_root: &Path,
) -> AppResult<TextRefreshReport> {
    let done: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [SETTING],
            |r| r.get(0),
        )
        .optional()?;
    let mut report = TextRefreshReport::default();
    if done.and_then(|v| v.parse::<i64>().ok()).unwrap_or(1) >= EXTRACTION_VERSION {
        return Ok(report);
    }
    let epubs: Vec<(String, String)> = conn
        .prepare(
            "SELECT s.id, f.relative_path FROM sources s
             JOIN source_files f ON f.source_id = s.id AND f.is_primary = 1 AND f.deleted_at IS NULL
             WHERE s.deleted_at IS NULL AND f.format = 'epub'
             ORDER BY s.created_at, s.id",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, relative) in epubs {
        report.checked += 1;
        match refresh_source(conn, sources_root, &id, &relative) {
            Ok(true) => report.updated += 1,
            Ok(false) => {}
            Err(error) => {
                report.failed += 1;
                log::warn!("the text of source {id} could not be refreshed: {error}");
            }
        }
    }
    if report.failed == 0 {
        conn.execute(
            "INSERT INTO settings (key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![SETTING, EXTRACTION_VERSION.to_string(), now()],
        )?;
    }
    if report.checked > 0 {
        log::info!(
            "EPUB text refreshed: {} checked, {} updated, {} failed",
            report.checked,
            report.updated,
            report.failed
        );
    }
    Ok(report)
}

/// A paragraph's text as compared across extraction versions: whitespace runs
/// (a non-breaking space included) collapsed to one space, and C1 control
/// characters read as Windows-1252, as the current extraction reads `&#146;`
/// (earlier versions stored U+0092). Every other character is kept exactly:
/// Korean, Greek, Hebrew and accented text stay what they are.
fn comparable(text: &str) -> String {
    text.split_whitespace()
        .map(|word| word.chars().map(c1_as_windows_1252).collect::<String>())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a stored paragraph is the same paragraph as a newly extracted one
/// (given in [`comparable`] form): either the same text, or the same once the
/// character references the earlier extraction left literal (`&dagger;`,
/// `&#8224;`) are decoded **once**. A stored `&amp;dagger;` is compared as
/// `&dagger;`, never as `†`.
fn same_paragraph(stored: &str, fresh: &str) -> bool {
    comparable(stored) == fresh
        || (stored.contains('&') && comparable(&decode_references_once(stored)) == fresh)
}

/// Extracts one EPUB again and updates its stored segments where they differ.
/// Returns whether anything changed.
fn refresh_source(conn: &Connection, root: &Path, id: &str, relative: &str) -> AppResult<bool> {
    let bytes = original::read_managed(root, id, relative, MAX_FILE)?;
    let fresh = EpubImporter.extract(&bytes, "book.epub")?.segments;
    struct Old {
        id: String,
        position: i64,
        content: String,
        chapter: Option<String>,
        heading: Option<String>,
        section_path: Option<String>,
        paragraph_index: Option<i64>,
    }
    let old: Vec<Old> = conn
        .prepare(
            "SELECT id, position, content, chapter, heading, section_path, paragraph_index
             FROM source_segments WHERE source_id = ?1 ORDER BY position",
        )?
        .query_map([id], |r| {
            Ok(Old {
                id: r.get(0)?,
                position: r.get(1)?,
                content: r.get(2)?,
                chapter: r.get(3)?,
                heading: r.get(4)?,
                section_path: r.get(5)?,
                paragraph_index: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    if fresh.is_empty() {
        // Nothing readable now: keep what was stored rather than empty the book.
        return Ok(false);
    }

    // Each stored paragraph is matched with the same paragraph in the new text, in order.
    let fresh_keys: Vec<String> = fresh.iter().map(|s| comparable(&s.text)).collect();
    let mut matched: Vec<Option<usize>> = vec![None; fresh.len()];
    let mut next = 0usize;
    for (index, segment) in old.iter().enumerate() {
        let end = (next + WINDOW).min(fresh.len());
        if let Some(at) = (next..end).find(|&k| same_paragraph(&segment.content, &fresh_keys[k])) {
            matched[at] = Some(index);
            next = at + 1;
        }
    }
    let unchanged = old.len() == fresh.len()
        && old.iter().zip(&fresh).enumerate().all(|(k, (o, n))| {
            matched[k] == Some(k)
                && o.content == n.text
                && o.chapter == n.chapter
                && o.heading == n.heading
                && o.section_path == n.section_path
                && o.position == k as i64
        });
    if unchanged {
        return Ok(false);
    }

    let (file_id, status): (String, String) = conn.query_row(
        "SELECT id, extraction_status FROM source_files
         WHERE source_id = ?1 AND is_primary = 1 AND deleted_at IS NULL",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let now = now();
    let kept: std::collections::HashSet<usize> = matched.iter().flatten().copied().collect();
    let tx = conn.unchecked_transaction()?;
    // Paragraphs no longer found go (a citation of one keeps its quotation and locator).
    for (index, segment) in old.iter().enumerate() {
        if !kept.contains(&index) {
            tx.execute("DELETE FROM source_segments WHERE id = ?1", [&segment.id])?;
        }
    }
    let row = |s: &NewSegment| (s.locator(), s.paragraph_index.map(i64::from));
    for (position, segment) in fresh.iter().enumerate() {
        let (locator, paragraph) = row(segment);
        match matched[position] {
            Some(index) => {
                let o = &old[index];
                if o.content != segment.text
                    || o.chapter != segment.chapter
                    || o.heading != segment.heading
                    || o.section_path != segment.section_path
                    || o.paragraph_index != paragraph
                    || o.position != position as i64
                {
                    tx.execute(
                        "UPDATE source_segments SET position = ?2, content = ?3, chapter = ?4,
                             heading = ?5, section_path = ?6, paragraph_index = ?7, locator = ?8,
                             updated_at = ?9
                         WHERE id = ?1",
                        params![
                            o.id,
                            position as i64,
                            segment.text,
                            segment.chapter,
                            segment.heading,
                            segment.section_path,
                            paragraph,
                            locator,
                            now
                        ],
                    )?;
                }
            }
            None => {
                tx.execute(
                    "INSERT INTO source_segments (id, source_id, source_file_id, position, content,
                         page_number, page_label, chapter, heading, section_path, paragraph_index,
                         char_start, char_end, locator, extraction_status, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?11, ?12, ?12)",
                    params![
                        new_id(),
                        id,
                        file_id,
                        position as i64,
                        segment.text,
                        segment.chapter,
                        segment.heading,
                        segment.section_path,
                        paragraph,
                        locator,
                        status,
                        now
                    ],
                )?;
            }
        }
    }
    tx.commit()?;
    // Offsets of references moved with the text: the passage index is made again.
    library::reindex_passages(conn, id)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{comparable, same_paragraph};

    fn same(stored: &str, fresh: &str) -> bool {
        same_paragraph(stored, &comparable(fresh))
    }

    #[test]
    fn a_reference_left_literal_matches_its_one_pass_decoding() {
        assert!(same("Notes &dagger; here", "Notes † here"));
        assert!(same("A &#8212; B &#x2020; C", "A — B † C"));
        assert!(same("&bull; One &hellip;", "• One …"));
        // an earlier version stored &#146; as U+0092; the current one reads it as Windows-1252
        assert!(same("don\u{92}t", "don’t"));
        // decoded once only: a stored &amp;dagger; is "&dagger;", which the new text also has
        assert!(same("Two &dagger; stays", "Two &dagger; stays"));
        assert!(!same("Two &amp;dagger; stays", "Two † stays"));
        // a stray & is itself
        assert!(same("Q&A follows", "Q&A follows"));
        assert!(!same("Q&A follows", "Q&B follows"));
    }

    #[test]
    fn different_text_in_any_script_never_matches() {
        assert!(!same(
            "하나님이 세상을 사랑하사",
            "하나님이 세상을 미워하사"
        ));
        assert!(!same("요한복음 15장", "요한복음 16장"));
        assert!(!same("Ἐν ἀρχῇ ἦν ὁ λόγος", "Ἐν ἀρχῇ ἦν ὁ θεός"));
        assert!(!same("λόγος", "λογος"), "accents are part of the text");
        assert!(!same("בְּרֵאשִׁית בָּרָא", "בְּרֵאשִׁית אֱלֹהִים"));
        assert!(!same("Römer", "Rømer"));
        assert!(!same("Gnade über Gnade", "Gnade uber Gnade"));
        assert!(!same("élu", "elu"));
    }

    #[test]
    fn the_same_unicode_text_matches_and_spacing_may_differ() {
        assert!(same("하나님이 세상을 사랑하사", "하나님이 세상을 사랑하사"));
        assert!(same("Ἐν ἀρχῇ ἦν ὁ λόγος", "Ἐν ἀρχῇ ἦν ὁ λόγος"));
        assert!(same("Part 1 —  here", "Part\u{a0}1 — here"));
        assert!(same("  leading and trailing  ", "leading and trailing"));
    }
}
