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
/// (`scripture::resolve`). The context: `translation_id`, the Bible the
/// person is reading — its stored language tag decides first, and a Bible
/// without one (or an unknown id) is simply no signal; then `language`, the
/// interface language. Neither is a gate.
#[tauri::command(async)]
pub fn scripture_reference_parse(
    state: State<'_, AppState>,
    text: String,
    language: Option<String>,
    translation_id: Option<String>,
) -> CommandResult<ScriptureRefDto> {
    let interface = resolve::preferred(language.as_deref());
    let id = translation_id.filter(|id| !id.is_empty());
    // The language of the Bible being read, and every installed Bible's own
    // verses beyond the canon (v0.18.3).
    let read = state.db(|conn| {
        let bible = id.as_deref().and_then(|id| bible_language(conn, id));
        Ok(resolve::resolve_with(
            &text,
            resolve::Context::new(bible, interface),
            &|book, chapter, verse| bibles::any_has_verse(conn, book, chapter, verse),
        ))
    });
    // A database that cannot be read now is no signal, never a failed parse.
    if let Ok(result) = read {
        return Ok(result?.to_dto());
    }
    Ok(resolve::resolve(&text, resolve::Context::new(None, interface))?.to_dto())
}

/// The reference language of a Bible from its stored language tag only.
fn bible_language(conn: &rusqlite::Connection, id: &str) -> Option<ReferenceLanguage> {
    let translation = bibles::get(conn, id).ok()?;
    resolve::language_of_tag(translation.language_code.as_deref())
}

/// The explicit references in a text, read as a source in `language` — the
/// language of the text when the caller knows it (never the interface
/// language); English without one, as before.
#[tauri::command(async)]
pub fn scripture_reference_detect(
    text: String,
    language: Option<String>,
) -> Vec<DetectedReference> {
    let text: String = text.chars().take(MAX_DETECT_CHARS).collect();
    let source = resolve::preferred(language.as_deref()).unwrap_or(ReferenceLanguage::En);
    Recogniser::for_source(source).detect(&text)
}
