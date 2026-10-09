use tauri::State;

use super::CommandResult;
use crate::db::bibles;
use crate::scripture::concordance::{self, ConcordanceQuery, ConcordanceResult};
use crate::scripture::parser::{DetectedReference, ReferenceParser};
use crate::scripture::reference::{ScriptureRef, ScriptureRefDto};
use crate::scripture::{
    self, BookInfo, ChapterText, GetChapter, GetPassage, PassageText, SearchResults,
    SearchScripture,
};
use crate::state::AppState;

/// Longest text accepted for reference detection.
const MAX_DETECT_CHARS: usize = 200_000;

#[tauri::command(async)]
pub fn scripture_books() -> Vec<BookInfo> {
    scripture::books()
}

#[tauri::command(async)]
pub fn scripture_get_chapter(
    state: State<'_, AppState>,
    input: GetChapter,
) -> CommandResult<ChapterText> {
    state.db(|conn| bibles::chapter(conn, &input.translation_id, &input.book, input.chapter))
}

#[tauri::command(async)]
pub fn scripture_get_passage(
    state: State<'_, AppState>,
    input: GetPassage,
) -> CommandResult<PassageText> {
    let reference = ScriptureRef::from_canonical(&input.reference)?;
    state.db(|conn| bibles::passage(conn, &input.translation_id, &reference))
}

#[tauri::command(async)]
pub fn scripture_search(
    state: State<'_, AppState>,
    input: SearchScripture,
) -> CommandResult<SearchResults> {
    state.db(|conn| bibles::search(conn, &input))
}

/// Where a word or phrase occurs in one translation (v0.12 concordance).
#[tauri::command(async)]
pub fn scripture_concordance(
    state: State<'_, AppState>,
    input: ConcordanceQuery,
) -> CommandResult<ConcordanceResult> {
    state.db(|conn| concordance::search(conn, &input))
}

#[tauri::command(async)]
pub fn scripture_reference_parse(text: String) -> CommandResult<ScriptureRefDto> {
    Ok(ReferenceParser::english().parse(&text)?.to_dto())
}

#[tauri::command(async)]
pub fn scripture_reference_detect(text: String) -> Vec<DetectedReference> {
    let text: String = text.chars().take(MAX_DETECT_CHARS).collect();
    ReferenceParser::english().detect(&text)
}
