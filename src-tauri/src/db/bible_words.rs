//! Annotated words of a Bible (v0.21): written at import, read by the lemma
//! concordance and the word inspector. Everything is scoped to one
//! translation: its words, its lemmas, its lexical identifiers and its
//! morphology codes, exactly as its own markup gave them. No lemma, code or
//! identifier is carried from one translation to another, inferred, or
//! looked up anywhere else.
//!
//! Counts come from the stored rows only: an occurrence is one `bible_words`
//! row, and its highlight is that row's offsets into the verse text.

use std::collections::{BTreeMap, HashMap};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::concordance::{
    self, ConcordanceBook, ConcordanceHit, BOOK_VERSES_LIMIT, INLINE_VERSES,
};
use crate::scripture::import::StagedContent;
use crate::scripture::morphology::{self, Described};
use crate::scripture::reference::{split_key, verse_key, ScriptureRef};
use crate::scripture::usfm::WordShape;
use crate::scripture::{canon, WordAnnotations};

/// The longest text looked up.
pub const LOOKUP_MAX_CHARS: usize = 120;
/// The most entries a lookup lists.
pub const ENTRIES_MAX: usize = 30;
/// The most written forms and morphology codes listed with a result.
const FORMS_MAX: usize = 40;
const CODES_MAX: usize = 200;

/// A lemma as compared when typed: the concordance's folding (accents,
/// points and case ignored), with joiners and soft hyphens left out.
pub fn fold(text: &str) -> String {
    let plain: String = text
        .chars()
        .filter(|c| !matches!(c, '\u{2060}' | '\u{200C}' | '\u{200D}' | '\u{00AD}'))
        .collect();
    concordance::normalize(&plain)
}

/// An entry while it is written: its row id once inserted, how many words
/// carry it, and its lexical identifiers.
struct NewEntry<'a> {
    id: i64,
    occurrences: usize,
    ids: &'a [String],
}

/// The stored letter of a word's shape.
fn shape_code(shape: WordShape) -> &'static str {
    match shape {
        WordShape::Word => "w",
        WordShape::Phrase => "p",
        WordShape::Part => "t",
    }
}

fn shape_name(code: &str) -> &'static str {
    match code {
        "p" => "phrase",
        "t" => "part",
        _ => "word",
    }
}

/// Writes the staged words of an import, inside its transaction: the
/// annotations' record, one entry per distinct (lemma, `strong`) with its
/// lexical identifiers, then the words.
pub fn insert(
    tx: &Transaction,
    translation_id: &str,
    content: &StagedContent,
    now: &str,
) -> AppResult<()> {
    let report = &content.words.report;
    if !report.indexed {
        return Ok(());
    }
    tx.execute(
        "INSERT INTO bible_word_annotations
             (translation_id, source_format, word_count, verse_count, lemma_count, strong_count,
              morph_count, morph_attribute, morph_scheme, details, created_at)
         VALUES (?1, 'usfm', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            translation_id,
            report.words as i64,
            report.verses as i64,
            report.with_lemma as i64,
            report.with_lexical_id as i64,
            report.with_morphology as i64,
            report.morph_attribute,
            report.morph_scheme,
            serde_json::to_string(report).unwrap_or_else(|_| "{}".into()),
            now
        ],
    )?;
    let annotation = tx.last_insert_rowid();

    // The entries, with how often each occurs, in first-seen order.
    let staged = || {
        content.books.iter().flat_map(|(ordinal, book)| {
            book.chapters.iter().flat_map(move |(chapter, text)| {
                text.words
                    .iter()
                    .map(move |(verse, words)| (verse_key(*ordinal, *chapter, *verse), words))
            })
        })
    };
    let mut entries: HashMap<(Option<&str>, Option<&str>), NewEntry> = HashMap::new();
    let mut order: Vec<(Option<&str>, Option<&str>)> = Vec::new();
    for (_, words) in staged() {
        for w in words {
            let key = (w.lemma.as_deref(), w.strong.as_deref());
            let entry = entries.entry(key).or_insert_with(|| {
                order.push(key);
                NewEntry {
                    id: 0,
                    occurrences: 0,
                    ids: w.ids.as_slice(),
                }
            });
            entry.occurrences += 1;
        }
    }
    let mut add_entry = tx.prepare(
        "INSERT INTO bible_lemma_entries (annotation_id, lemma, lemma_fold, strong, occurrences)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    let mut add_id =
        tx.prepare("INSERT OR IGNORE INTO bible_entry_ids (value, entry_id) VALUES (?1, ?2)")?;
    for key in &order {
        let Some(entry) = entries.get_mut(key) else {
            continue;
        };
        let (lemma, strong) = *key;
        add_entry.execute(params![
            annotation,
            lemma,
            lemma.map(fold),
            strong,
            entry.occurrences as i64
        ])?;
        entry.id = tx.last_insert_rowid();
        for id in entry.ids {
            add_id.execute(params![id, entry.id])?;
        }
    }

    let mut add_word = tx.prepare(
        "INSERT INTO bible_words (annotation_id, verse_id, position, start_offset, end_offset,
             surface, shape, entry_id, morph)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    for (key, words) in staged() {
        for (position, w) in words.iter().enumerate() {
            let entry = entries
                .get(&(w.lemma.as_deref(), w.strong.as_deref()))
                .map_or(0, |e| e.id);
            add_word.execute(params![
                annotation,
                key,
                position as i64,
                w.start as i64,
                w.end as i64,
                w.surface,
                shape_code(w.shape),
                entry,
                w.morph
            ])?;
        }
    }
    Ok(())
}

/// Removes a translation's word index (words, then entries and their
/// identifiers, then the record), inside the caller's transaction.
pub fn remove(tx: &Transaction, translation_id: &str) -> AppResult<()> {
    let key: Option<i64> = tx
        .query_row(
            "SELECT id FROM bible_word_annotations WHERE translation_id = ?1",
            [translation_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(key) = key else { return Ok(()) };
    tx.execute("DELETE FROM bible_words WHERE annotation_id = ?1", [key])?;
    tx.execute(
        "DELETE FROM bible_entry_ids WHERE entry_id IN (SELECT id FROM bible_lemma_entries WHERE annotation_id = ?1)",
        [key],
    )?;
    tx.execute(
        "DELETE FROM bible_lemma_entries WHERE annotation_id = ?1",
        [key],
    )?;
    tx.execute("DELETE FROM bible_word_annotations WHERE id = ?1", [key])?;
    Ok(())
}

fn unavailable() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "words.unavailable",
        "This Bible has no word annotations (lemmas or grammar), so this search is not available for it. The ordinary concordance still works.",
    ))
}

/// The Bible's annotations and their key, or why there are none.
fn annotations(conn: &Connection, translation_id: &str) -> AppResult<(WordAnnotations, i64)> {
    let translation = crate::db::bibles::get(conn, translation_id)?;
    let words = translation.words.ok_or_else(unavailable)?;
    let key: i64 = conn
        .query_row(
            "SELECT id FROM bible_word_annotations WHERE translation_id = ?1",
            [translation_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(unavailable)?;
    Ok((words, key))
}

/// One dictionary entry of a Bible's annotations: a lemma with the lexical
/// identifiers given with it. Homographs (one lemma, different identifiers)
/// are separate entries; nothing joins them but the person's choice.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LemmaEntry {
    pub lemma: Option<String>,
    /// The `strong` value as written.
    pub strong: Option<String>,
    pub occurrences: i64,
    /// The most frequent written forms (exact spelling), most frequent first.
    pub forms: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LemmaLookup {
    pub translation_id: String,
    /// A lemma (accents, points and case ignored) or a lexical identifier (exact).
    pub text: String,
}

fn empty() -> AppError {
    invalid(
        "words.empty",
        "Type a lemma or a lexical number to look for.",
    )
}

/// The entries a typed lemma or identifier names, most frequent first.
pub fn entries(conn: &Connection, input: &LemmaLookup) -> AppResult<Vec<LemmaEntry>> {
    let (_, key) = annotations(conn, &input.translation_id)?;
    let text: String = input.text.trim().chars().take(LOOKUP_MAX_CHARS).collect();
    if text.is_empty() {
        return Err(empty());
    }
    let folded = fold(&text);
    let mut stmt = conn.prepare(
        "SELECT id, lemma, strong, occurrences FROM bible_lemma_entries
         WHERE annotation_id = ?1 AND (lemma = ?2 OR lemma_fold = ?3
               OR EXISTS (SELECT 1 FROM bible_entry_ids i
                          WHERE i.entry_id = bible_lemma_entries.id AND i.value = ?2 COLLATE NOCASE))
         ORDER BY occurrences DESC, lemma, strong
         LIMIT ?4",
    )?;
    let found = stmt
        .query_map(params![key, text, folded, ENTRIES_MAX as i64], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut forms = conn.prepare_cached(
        "SELECT surface FROM bible_words WHERE entry_id = ?1
         GROUP BY surface ORDER BY COUNT(*) DESC, surface LIMIT 5",
    )?;
    found
        .into_iter()
        .map(|(id, lemma, strong, occurrences)| {
            Ok(LemmaEntry {
                lemma,
                strong,
                occurrences,
                forms: forms
                    .query_map([id], |r| r.get(0))?
                    .collect::<Result<Vec<String>, _>>()?,
            })
        })
        .collect()
}

/// Which words a lemma search finds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LemmaSelection {
    /// One entry: this lemma with exactly these identifiers (either may be absent).
    Entry {
        lemma: Option<String>,
        strong: Option<String>,
    },
    /// This lemma, whatever identifiers its words carry.
    Lemma { lemma: String },
    /// Every word carrying this lexical identifier (one value or part).
    LexicalId { id: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LemmaQuery {
    pub translation_id: String,
    pub selection: LemmaSelection,
    /// Only words with one of these morphology codes (exactly as written).
    #[serde(default)]
    pub morph: Vec<String>,
    /// Only this book's verses (canonical code); the counts stay for the whole Bible.
    #[serde(default)]
    pub book: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FormCount {
    pub form: String,
    pub count: usize,
}

/// A morphology code among the occurrences, with its description when the
/// Bible's scheme is one that is described (see `scripture::morphology`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MorphCount {
    pub code: String,
    pub count: usize,
    pub described: Option<Described>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LemmaResult {
    pub selection: LemmaSelection,
    pub translation_id: String,
    /// Words found (after the morphology filter) and the verses holding them.
    pub occurrences: usize,
    pub verses: usize,
    pub books: Vec<ConcordanceBook>,
    pub hits: Vec<ConcordanceHit>,
    pub hits_complete: bool,
    /// Written forms of all the selection's words (before the filter).
    pub forms: Vec<FormCount>,
    /// Morphology codes of all the selection's words (before the filter).
    pub morphology: Vec<MorphCount>,
    /// Words without a morphology code (before the filter).
    pub without_morphology: usize,
    pub morph_scheme: String,
    pub morph_attribute: Option<String>,
}

/// Highlight ranges (UTF-16) of one verse's occurrences.
type VerseMatches = Vec<(usize, usize)>;

struct Row {
    verse: i64,
    start: i64,
    end: i64,
    surface: String,
    morph: Option<String>,
}

fn invalid(key: &'static str, message: &str) -> AppError {
    AppError::InvalidInput(UserMessage::new(key, message))
}

/// The entries a selection means, in this Bible only.
fn selected_entries(
    conn: &Connection,
    key: i64,
    selection: &LemmaSelection,
) -> AppResult<Vec<i64>> {
    let ids = match selection {
        LemmaSelection::Entry { lemma, strong } => {
            if lemma.is_none() && strong.is_none() {
                return Err(empty());
            }
            let mut stmt = conn.prepare(
                "SELECT id FROM bible_lemma_entries WHERE annotation_id = ?1 AND lemma IS ?2 AND strong IS ?3",
            )?;
            let rows = stmt.query_map(params![key, lemma, strong], |r| r.get(0))?;
            rows.collect::<Result<Vec<i64>, _>>()?
        }
        LemmaSelection::Lemma { lemma } => {
            let mut stmt = conn.prepare(
                "SELECT id FROM bible_lemma_entries WHERE annotation_id = ?1 AND lemma = ?2",
            )?;
            let rows = stmt.query_map(params![key, lemma.trim()], |r| r.get(0))?;
            rows.collect::<Result<Vec<i64>, _>>()?
        }
        LemmaSelection::LexicalId { id } => {
            let mut stmt = conn.prepare(
                "SELECT e.id FROM bible_lemma_entries e
                 WHERE e.annotation_id = ?2 AND EXISTS (SELECT 1 FROM bible_entry_ids i
                       WHERE i.entry_id = e.id AND i.value = ?1 COLLATE NOCASE)",
            )?;
            // Letter case aside ("h7225" finds "H7225"), as in `entries`.
            let rows = stmt.query_map(params![id.trim(), key], |r| r.get(0))?;
            rows.collect::<Result<Vec<i64>, _>>()?
        }
    };
    Ok(ids)
}

/// The words of those entries, in canonical order.
fn rows(conn: &Connection, entries: &[i64]) -> AppResult<Vec<(i64, Row)>> {
    let mut stmt = conn.prepare_cached(
        "SELECT verse_id, position, start_offset, end_offset, surface, morph
         FROM bible_words WHERE entry_id = ?1",
    )?;
    let mut out = Vec::new();
    for entry in entries {
        let found = stmt.query_map([entry], |r| {
            Ok((
                r.get::<_, i64>(1)?,
                Row {
                    verse: r.get(0)?,
                    start: r.get(2)?,
                    end: r.get(3)?,
                    surface: r.get(4)?,
                    morph: r.get(5)?,
                },
            ))
        })?;
        for row in found {
            out.push(row?);
        }
    }
    out.sort_by_key(|(position, r)| (r.verse, *position));
    Ok(out)
}

/// Where a lemma (or lexical identifier) occurs in one Bible, from its own
/// annotations only.
pub fn search(conn: &Connection, input: &LemmaQuery) -> AppResult<LemmaResult> {
    let (words, key) = annotations(conn, &input.translation_id)?;
    let scheme = words.morph_scheme.clone();
    let only_book = match input.book.as_deref().filter(|b| !b.is_empty()) {
        Some(code) => Some(
            canon::by_code(code)
                .ok_or_else(|| invalid("reference.notABook", "That is not a book of the Bible."))?,
        ),
        None => None,
    };
    let entries = selected_entries(conn, key, &input.selection)?;
    let all: Vec<Row> = rows(conn, &entries)?.into_iter().map(|(_, r)| r).collect();

    // Forms and codes of every occurrence, before any filter.
    let mut forms: HashMap<&str, usize> = HashMap::new();
    let mut codes: HashMap<&str, usize> = HashMap::new();
    let mut without = 0usize;
    for r in &all {
        *forms.entry(r.surface.as_str()).or_default() += 1;
        match &r.morph {
            Some(code) => *codes.entry(code.as_str()).or_default() += 1,
            None => without += 1,
        }
    }
    let mut forms: Vec<FormCount> = forms
        .into_iter()
        .map(|(form, count)| FormCount {
            form: form.to_string(),
            count,
        })
        .collect();
    forms.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.form.cmp(&b.form)));
    forms.truncate(FORMS_MAX);
    let mut morphology: Vec<MorphCount> = codes
        .into_iter()
        .map(|(code, count)| MorphCount {
            code: code.to_string(),
            count,
            described: morphology::describe(&scheme, code),
        })
        .collect();
    morphology.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.code.cmp(&b.code)));
    morphology.truncate(CODES_MAX);

    let wanted: Vec<&str> = input
        .morph
        .iter()
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .collect();
    let kept: Vec<&Row> = all
        .iter()
        .filter(|r| wanted.is_empty() || r.morph.as_deref().is_some_and(|m| wanted.contains(&m)))
        .collect();

    // Per verse, per book, in canonical order.
    let mut by_verse: BTreeMap<i64, VerseMatches> = BTreeMap::new();
    for r in &kept {
        by_verse
            .entry(r.verse)
            .or_default()
            .push((r.start as usize, r.end as usize));
    }
    let mut by_book: BTreeMap<u8, (usize, usize)> = BTreeMap::new();
    for (verse, matches) in &by_verse {
        let (ordinal, _, _) = split_key(*verse);
        let entry = by_book.entry(ordinal).or_default();
        entry.0 += 1;
        entry.1 += matches.len();
    }
    let books = by_book
        .iter()
        .filter_map(|(ordinal, (v, o))| {
            canon::by_ordinal(*ordinal).map(|b| ConcordanceBook {
                code: b.code.to_string(),
                name: b.name.to_string(),
                verses: *v,
                occurrences: *o,
            })
        })
        .collect();
    let verses = by_verse.len();
    let (listed, hits_complete): (Vec<(&i64, &VerseMatches)>, bool) = match only_book {
        Some(book) => {
            let (low, high) = (
                verse_key(book.ordinal, 0, 0),
                verse_key(book.ordinal, 999, 999),
            );
            let mine: Vec<_> = by_verse.range(low..=high).collect();
            let complete = mine.len() <= BOOK_VERSES_LIMIT;
            (mine.into_iter().take(BOOK_VERSES_LIMIT).collect(), complete)
        }
        None if verses <= INLINE_VERSES => (by_verse.iter().collect(), true),
        None => (Vec::new(), false),
    };
    let mut text_of = conn.prepare_cached(
        "SELECT text FROM bible_verse_texts WHERE translation_id = ?1 AND verse_id = ?2",
    )?;
    let mut hits = Vec::with_capacity(listed.len());
    for (verse, matches) in listed {
        let Some(text) = text_of
            .query_row(params![input.translation_id, verse], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
        else {
            continue;
        };
        let (ordinal, chapter, number) = split_key(*verse);
        let Some(book) = canon::by_ordinal(ordinal) else {
            continue;
        };
        // Offsets were made from this text; one that no longer fits is not shown.
        let length = text.encode_utf16().count();
        let matches: Vec<(usize, usize)> = matches
            .iter()
            .copied()
            .filter(|(_, e)| *e <= length)
            .collect();
        hits.push(ConcordanceHit {
            reference: ScriptureRef::verse(book, chapter, number)?.to_dto(),
            text,
            matches,
        });
    }
    Ok(LemmaResult {
        selection: input.selection.clone(),
        translation_id: input.translation_id.clone(),
        occurrences: kept.len(),
        verses,
        books,
        hits,
        hits_complete,
        forms,
        morphology,
        without_morphology: without,
        morph_scheme: scheme,
        morph_attribute: words.morph_attribute,
    })
}

/// One annotated word of a verse, for the word inspector.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerseWord {
    pub position: i64,
    pub start: i64,
    pub end: i64,
    pub surface: String,
    /// "word", "phrase" or "part".
    pub shape: String,
    pub lemma: Option<String>,
    pub strong: Option<String>,
    pub lexical_ids: Vec<String>,
    pub morph: Option<String>,
    pub described: Option<Described>,
    /// How often this entry (lemma and identifiers) occurs in this Bible.
    pub entry_occurrences: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseWordsQuery {
    pub translation_id: String,
    /// A verse, e.g. "JHN.1.1" (a bridge: its first verse).
    pub verse: String,
}

/// The annotated words of one verse, in order.
pub fn verse_words(conn: &Connection, input: &VerseWordsQuery) -> AppResult<Vec<VerseWord>> {
    let (words, key) = annotations(conn, &input.translation_id)?;
    let reference = ScriptureRef::from_canonical(&input.verse)?;
    let verse = verse_key(
        reference.book.ordinal,
        reference.start.chapter,
        reference.start.verse.unwrap_or(1),
    );
    let mut stmt = conn.prepare(
        "SELECT w.position, w.start_offset, w.end_offset, w.surface, w.shape, e.lemma, e.strong,
                w.morph, e.occurrences, e.id
         FROM bible_words w JOIN bible_lemma_entries e ON e.id = w.entry_id
         WHERE w.annotation_id = ?1 AND w.verse_id = ?2 ORDER BY w.position",
    )?;
    let raw = stmt
        .query_map(params![key, verse], |r| {
            Ok((
                r.get::<_, i64>(9)?,
                VerseWord {
                    position: r.get(0)?,
                    start: r.get(1)?,
                    end: r.get(2)?,
                    surface: r.get(3)?,
                    shape: shape_name(&r.get::<_, String>(4)?).to_string(),
                    lemma: r.get(5)?,
                    strong: r.get(6)?,
                    lexical_ids: Vec::new(),
                    morph: r.get(7)?,
                    described: None,
                    entry_occurrences: r.get(8)?,
                },
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = conn
        .prepare_cached("SELECT value FROM bible_entry_ids WHERE entry_id = ?1 ORDER BY value")?;
    raw.into_iter()
        .map(|(entry, mut word)| {
            word.lexical_ids = ids
                .query_map([entry], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            word.described = word
                .morph
                .as_deref()
                .and_then(|m| morphology::describe(&words.morph_scheme, m));
            Ok(word)
        })
        .collect()
}
