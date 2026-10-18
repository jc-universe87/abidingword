use tauri::State;

use super::CommandResult;
use crate::db::bibles;
use crate::scripture::concordance::{self, ConcordanceQuery, ConcordanceResult};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::DetectedReference;
use crate::scripture::recognise::Recogniser;
use crate::scripture::reference::{ScriptureRef, ScriptureRefDto};
use crate::scripture::resolve;
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

/// A typed reference in any of the 100 reference languages
/// (`scripture::resolve`). `language` is the interface language: it settles a
/// genuine tie between languages, nothing else.
#[tauri::command(async)]
pub fn scripture_reference_parse(
    text: String,
    language: Option<String>,
) -> CommandResult<ScriptureRefDto> {
    let preferred = resolve::preferred(language.as_deref());
    Ok(resolve::resolve(&text, preferred)?.to_dto())
}

/// The explicit references in a text, read as a source in `language` (the
/// interface language when the text has none of its own; English without one).
#[tauri::command(async)]
pub fn scripture_reference_detect(
    text: String,
    language: Option<String>,
) -> Vec<DetectedReference> {
    let text: String = text.chars().take(MAX_DETECT_CHARS).collect();
    let source = resolve::preferred(language.as_deref()).unwrap_or(ReferenceLanguage::En);
    Recogniser::for_source(source).detect(&text)
}
