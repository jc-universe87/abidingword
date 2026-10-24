//! Installed Bible translations: import commit, removal, reading, search.
//!
//! Removal deletes a translation's own rows (text, superscriptions, search
//! entries) and nothing else. Canonical structure (`bible_books`,
//! `bible_chapters`, `bible_verses`), study passage links, findings and
//! translation-independent annotations are untouched; annotations tied to
//! the removed wording keep their passage and lose only the translation link.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::db::{new_id, now};
use crate::domain::validate;
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::canon;
use crate::scripture::import::StagedContent;
use crate::scripture::reference::{split_key, verse_key, ScriptureRef};
use crate::scripture::{
    BibleTranslation, ChapterText, CommitImport, PassageText, SearchHit, SearchResults,
    SearchScripture, VerseText,
};

const COLUMNS: &str = "id, name, short_name, language, language_code, publisher, \
    copyright_notice, license_type, kind, source_type, source_origin, source_path, \
    original_file_name, import_status, is_builtin, book_count, verse_count, created_at, updated_at, \
    (SELECT json_object('wordCount', a.word_count, 'verseCount', a.verse_count, \
        'lemmas', json(CASE WHEN a.lemma_count > 0 THEN 'true' ELSE 'false' END), \
        'lexicalIds', json(CASE WHEN a.strong_count > 0 THEN 'true' ELSE 'false' END), \
        'morphology', json(CASE WHEN a.morph_count > 0 THEN 'true' ELSE 'false' END), \
        'morphScheme', COALESCE(a.grammar_scheme, a.morph_scheme), \
        'morphAttribute', a.morph_attribute, 'sourceFormat', a.source_format, \
        'grammarBasis', a.grammar_basis, 'grammarEvidence', json(a.grammar_evidence)) \
     FROM bible_word_annotations a WHERE a.translation_id = bible_translations.id)";

const SHORT_NAME_MAX_CHARS: usize = 20;
const SEARCH_LIMIT: usize = 200;

fn from_row(row: &Row) -> rusqlite::Result<BibleTranslation> {
    Ok(BibleTranslation {
        id: row.get(0)?,
        name: row.get(1)?,
        short_name: row.get(2)?,
        language: row.get(3)?,
        language_code: row.get(4)?,
        publisher: row.get(5)?,
        copyright_notice: row.get(6)?,
        license_type: row.get(7)?,
        kind: row.get(8)?,
        source_type: row.get(9)?,
        source_origin: row.get(10)?,
        source_path: row.get(11)?,
        original_file_name: row.get(12)?,
        import_status: row.get(13)?,
        is_builtin: row.get(14)?,
        book_count: row.get(15)?,
        verse_count: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        words: row
            .get::<_, Option<String>>(19)?
            .and_then(|json| serde_json::from_str(&json).ok()),
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<BibleTranslation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM bible_translations ORDER BY name COLLATE NOCASE, short_name"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<BibleTranslation> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM bible_translations WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("Bible", id))
}

pub fn find_builtin(conn: &Connection, resource: &str) -> AppResult<Option<BibleTranslation>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {COLUMNS} FROM bible_translations WHERE is_builtin = 1 AND source_path = ?1"
            ),
            [resource],
            from_row,
        )
        .optional()?)
}

/// Where a committed translation's source lives.
pub struct SourceRecord {
    /// "bundled" or "managed_copy".
    pub origin: &'static str,
    pub path: Option<String>,
    pub original_file_name: Option<String>,
    pub format: &'static str,
    pub is_builtin: bool,
}

/// Writes a staged import in one transaction. Any failure leaves the
/// database exactly as it was.
pub fn commit_import(
    conn: &Connection,
    id: &str,
    content: &StagedContent,
    meta: &CommitImport,
    source: &SourceRecord,
) -> AppResult<BibleTranslation> {
    if content.has_errors() {
        return Err(AppError::Import(UserMessage::new(
            "bibles.hasProblems",
            "This Bible has problems that must be resolved before it can be added.",
        )));
    }
    let checked = check_details(conn, meta)?;
    let now = now();
    let tx = conn.unchecked_transaction()?;
    insert_translation(
        &tx,
        id,
        &checked,
        meta,
        source,
        Shape::Structured(content),
        &now,
    )?;
    insert_verses(&tx, id, content)?;
    crate::db::bible_words::insert(&tx, id, content, source.format, &meta.words, &now)?;
    tx.commit()?;
    log::info!(
        "Bible added: {} ({} books, {} verses)",
        checked.short_name,
        content.books.len(),
        content.verse_count()
    );
    get(conn, id)
}

/// The details of a Bible about to be added, checked.
pub struct CheckedDetails {
    pub name: String,
    pub short_name: String,
    pub language: String,
    pub language_code: Option<String>,
}

/// Checks the name, short name and language the person gave, and that the
/// short name is free.
pub fn check_details(conn: &Connection, meta: &CommitImport) -> AppResult<CheckedDetails> {
    let name = validate::title(&meta.name, "Bible")?;
    let short_name = validate::title(&meta.short_name, "Bible's short name")?;
    if short_name.chars().count() > SHORT_NAME_MAX_CHARS {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "bibles.shortNameTooLong",
                format!("Please keep the short name under {SHORT_NAME_MAX_CHARS} characters."),
            )
            .with("max", SHORT_NAME_MAX_CHARS),
        ));
    }
    let language = validate::title(&meta.language, "language")?;
    let language_code = language_tag(meta.language_code.as_deref())?;
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM bible_translations WHERE short_name = ?1 COLLATE NOCASE)",
        [&short_name],
        |r| r.get(0),
    )?;
    if taken {
        return Err(AppError::DuplicateTranslation(short_name));
    }
    Ok(CheckedDetails {
        name,
        short_name,
        language,
        language_code,
    })
}

/// What kind of Bible a translation row describes.
pub enum Shape<'a> {
    /// Readable by passage: its verses follow.
    Structured(&'a StagedContent),
    /// Read as a document only (v0.23): no verses.
    Document,
}

/// Inserts the translation's own row.
pub fn insert_translation(
    tx: &Connection,
    id: &str,
    checked: &CheckedDetails,
    meta: &CommitImport,
    source: &SourceRecord,
    shape: Shape,
    now: &str,
) -> AppResult<()> {
    let optional = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let (kind, status, books, verses) = match shape {
        Shape::Structured(content) => (
            "structured",
            "ready",
            content.books.len() as i64,
            content.verse_count() as i64,
        ),
        Shape::Document => ("document", "document_only", 0, 0),
    };
    tx.execute(
        "INSERT INTO bible_translations
             (id, name, short_name, language, language_code, publisher, copyright_notice,
              license_type, kind, source_type, source_origin, source_path, original_file_name,
              import_status, is_builtin, book_count, verse_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?18)",
        params![
            id,
            checked.name,
            checked.short_name,
            checked.language,
            checked.language_code,
            optional(&meta.publisher),
            optional(&meta.copyright_notice),
            optional(&meta.license_type),
            kind,
            source.format,
            source.origin,
            source.path,
            source.original_file_name,
            status,
            source.is_builtin,
            books,
            verses,
            now
        ],
    )?;
    Ok(())
}

/// Inserts a structured Bible's verses and Psalm titles.
pub fn insert_verses(tx: &Connection, id: &str, content: &StagedContent) -> AppResult<()> {
    let mut add_verse = tx.prepare(
        "INSERT OR IGNORE INTO bible_verses (id, book_id, chapter, verse) VALUES (?1, ?2, ?3, ?4)",
    )?;
    let mut add_text = tx.prepare(
        "INSERT INTO bible_verse_texts (translation_id, verse_id, text, bridge_end)
         VALUES (?1, ?2, ?3, ?4)",
    )?;
    let mut add_title = tx.prepare(
        "INSERT INTO bible_superscriptions (translation_id, book_id, chapter, text)
         VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (ordinal, book) in &content.books {
        for (chapter, text) in &book.chapters {
            for (verse, words) in &text.verses {
                let key = verse_key(*ordinal, *chapter, *verse);
                add_verse.execute(params![key, ordinal, chapter, verse])?;
                add_text.execute(params![id, key, words, text.bridges.get(verse)])?;
            }
            if let Some(title) = &text.superscription {
                add_title.execute(params![id, ordinal, chapter, title])?;
            }
        }
    }
    Ok(())
}

/// Removes a translation's own data. Returns what was removed so the caller
/// can delete Abiding Word's managed copy of the source files.
pub fn remove(conn: &Connection, id: &str) -> AppResult<BibleTranslation> {
    let translation = get(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    // Its word index first, in bulk (v0.21): left to the cascade, each entry
    // removed would look up its words one by one.
    crate::db::bible_words::remove(&tx, id)?;
    // A document Bible's text and its search entries (v0.23), explicitly.
    tx.execute(
        "DELETE FROM bible_document_segments
         WHERE document_id IN (SELECT id FROM bible_documents WHERE translation_id = ?1)",
        [id],
    )?;
    tx.execute("DELETE FROM bible_translations WHERE id = ?1", [id])?;
    // Forget it as the active translation.
    tx.execute(
        "DELETE FROM settings WHERE key = 'scripture.translation' AND value = ?1",
        [serde_json::to_string(id).unwrap_or_default()],
    )?;
    tx.commit()?;
    log::info!("Bible removed: {}", translation.short_name);
    Ok(translation)
}

fn verses_between(
    conn: &Connection,
    translation_id: &str,
    from_key: i64,
    to_key: i64,
) -> AppResult<Vec<VerseText>> {
    let mut stmt = conn.prepare(
        "SELECT v.book_id, v.chapter, v.verse, t.text
         FROM bible_verse_texts t JOIN bible_verses v ON v.id = t.verse_id
         WHERE t.translation_id = ?1 AND t.verse_id BETWEEN ?2 AND ?3
         ORDER BY t.verse_id",
    )?;
    let rows = stmt.query_map(params![translation_id, from_key, to_key], |r| {
        Ok((
            r.get::<_, u8>(0)?,
            r.get::<_, u16>(1)?,
            r.get::<_, u16>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut verses = Vec::new();
    for row in rows {
        let (ordinal, chapter, verse, text) = row?;
        let code = canon::by_ordinal(ordinal).map_or("", |b| b.code);
        verses.push(VerseText {
            canonical: format!("{code}.{chapter}.{verse}"),
            chapter,
            verse,
            text,
        });
    }
    Ok(verses)
}

/// A language tag as stored: well formed and normalised, or none. A value that
/// is not a tag (a name, a typo) is refused rather than stored.
fn language_tag(value: Option<&str>) -> AppResult<Option<String>> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(v) => crate::scripture::language::normalise_tag(v)
            .map(Some)
            .ok_or_else(|| {
                AppError::InvalidInput(
                    UserMessage::new(
                        "bibles.badLanguage",
                        format!("“{v}” is not a language this app knows."),
                    )
                    .with("text", v),
                )
            }),
    }
}

/// Changes the language of an installed Bible: its name as shown and its
/// tag (which typed references use first). Text, verses and references are
/// untouched.
pub fn set_language(
    conn: &Connection,
    id: &str,
    language: &str,
    language_code: Option<&str>,
) -> AppResult<BibleTranslation> {
    get(conn, id)?;
    let language = validate::title(language, "language")?;
    let language_code = language_tag(language_code)?;
    conn.execute(
        "UPDATE bible_translations SET language = ?2, language_code = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, language, language_code, now()],
    )?;
    get(conn, id)
}

/// Whether any installed Bible has this verse (by its own numbering): a
/// Bible that counts Psalm titles as verses (Ps 51:21) makes that citation
/// good whichever Bible is being read. Asked only for a verse beyond the
/// canon's count, so the scan is rare.
pub fn any_has_verse(conn: &Connection, book: &canon::Book, chapter: u16, verse: u16) -> bool {
    let verse_id = verse_key(book.ordinal, chapter, verse);
    conn.query_row(
        "SELECT 1 FROM bible_verse_texts WHERE verse_id = ?1 LIMIT 1",
        [verse_id],
        |_| Ok(()),
    )
    .is_ok()
}

pub fn chapter(
    conn: &Connection,
    translation_id: &str,
    book: &str,
    chapter: u16,
) -> AppResult<ChapterText> {
    get(conn, translation_id)?;
    let book = canon::by_code(book).ok_or_else(|| {
        AppError::InvalidReference(
            UserMessage::new(
                "reference.notABook",
                format!("“{book}” is not a book of the Bible."),
            )
            .with("text", book),
        )
    })?;
    let reference = ScriptureRef::chapter(book, chapter)?;
    let superscription = conn
        .query_row(
            "SELECT text FROM bible_superscriptions
             WHERE translation_id = ?1 AND book_id = ?2 AND chapter = ?3",
            params![translation_id, book.ordinal, chapter],
            |r| r.get(0),
        )
        .optional()?;
    Ok(ChapterText {
        translation_id: translation_id.to_string(),
        book: book.code,
        book_name: book.name,
        chapter,
        chapter_count: book.chapter_count,
        superscription,
        verses: verses_between(
            conn,
            translation_id,
            reference.start_key(),
            reference.end_key(),
        )?,
    })
}

pub fn passage(
    conn: &Connection,
    translation_id: &str,
    reference: &ScriptureRef,
) -> AppResult<PassageText> {
    get(conn, translation_id)?;
    Ok(PassageText {
        translation_id: translation_id.to_string(),
        reference: reference.to_dto(),
        verses: verses_between(
            conn,
            translation_id,
            reference.start_key(),
            reference.end_key(),
        )?,
    })
}

pub fn search(conn: &Connection, input: &SearchScripture) -> AppResult<SearchResults> {
    let Some(query) = crate::db::fts::query(&input.query) else {
        return Err(AppError::InvalidInput(UserMessage::new(
            "search.empty",
            "Type a word or phrase to search for.",
        )));
    };
    if let Some(id) = &input.translation_id {
        get(conn, id)?;
    }
    let range = match input.book.as_deref().filter(|b| !b.is_empty()) {
        Some(code) => {
            let book = canon::by_code(code).ok_or_else(|| {
                AppError::InvalidReference(
                    UserMessage::new(
                        "reference.notABook",
                        format!("“{code}” is not a book of the Bible."),
                    )
                    .with("text", code),
                )
            })?;
            Some((
                verse_key(book.ordinal, 0, 0),
                verse_key(book.ordinal, 999, 999),
            ))
        }
        None => None,
    };
    let mut stmt = conn.prepare(
        "SELECT t.verse_id, t.translation_id, tr.short_name, t.text
         FROM bible_verse_search s
         JOIN bible_verse_texts t ON t.id = s.rowid
         JOIN bible_translations tr ON tr.id = t.translation_id
         WHERE bible_verse_search MATCH ?1
           AND (?2 IS NULL OR t.translation_id = ?2)
           AND (?3 IS NULL OR t.verse_id BETWEEN ?3 AND ?4)
         ORDER BY t.verse_id, tr.short_name
         LIMIT ?5",
    )?;
    let rows = stmt.query_map(
        params![
            query,
            input.translation_id,
            range.map(|r| r.0),
            range.map(|r| r.1),
            (SEARCH_LIMIT + 1) as i64
        ],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        },
    )?;
    let mut hits = Vec::new();
    for row in rows {
        let (key, translation_id, short_name, text) = row?;
        let (ordinal, chapter, verse) = split_key(key);
        let Some(book) = canon::by_ordinal(ordinal) else {
            continue;
        };
        hits.push(SearchHit {
            reference: ScriptureRef::verse(book, chapter, verse)?.to_dto(),
            translation_id,
            translation_short_name: short_name,
            text,
        });
    }
    let truncated = hits.len() > SEARCH_LIMIT;
    hits.truncate(SEARCH_LIMIT);
    Ok(SearchResults { hits, truncated })
}

pub fn new_translation_id() -> String {
    new_id()
}

/// A verse of a material's passage: its text, and for a bridge ("25–27")
/// the last verse it covers.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialVerse {
    pub canonical: String,
    pub chapter: u16,
    pub verse: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge_end: Option<u16>,
    /// A psalm's title (or a like line before verse 1), on the chapter's
    /// first verse when the passage takes the chapter from its beginning.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub text: String,
}

/// One passage of a material, as the chosen Bible has it (v0.18.8).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPassage {
    /// The reference as the teaching names it (canonical form).
    pub canonical: String,
    pub verses: Vec<MaterialVerse>,
    /// Verses the passage covers that this Bible has no text for, as
    /// "chapter:verse", in order; the material says so and keeps the
    /// reference, and never takes them from another Bible.
    pub missing: Vec<String>,
}

/// The passages of a material, all from one Bible, with what the person may
/// want to say about where the text comes from.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaterialScripture {
    pub translation_id: String,
    pub name: String,
    pub short_name: String,
    pub copyright_notice: Option<String>,
    pub passages: Vec<MaterialPassage>,
}

/// The text of each passage from the one Bible chosen, checked against the
/// canon's verse counts so that a verse the Bible lacks is named instead of
/// silently left out. Verses a translation combines into one ("25–27") count
/// as there, and a passage that starts inside such a bridge starts with it.
/// A verse beyond the canon's count is read too, when the Bible has it
/// (versifications differ). Nothing is fetched, filled in, or taken from
/// another Bible; the text stays on this computer.
pub fn material_passages(
    conn: &Connection,
    translation_id: &str,
    references: &[ScriptureRef],
) -> AppResult<MaterialScripture> {
    let bible = get(conn, translation_id)?;
    let mut read = conn.prepare(
        "SELECT v.chapter, v.verse, t.text, t.bridge_end
         FROM bible_verse_texts t JOIN bible_verses v ON v.id = t.verse_id
         WHERE t.translation_id = ?1 AND t.verse_id BETWEEN ?2 AND ?3
         ORDER BY t.verse_id",
    )?;
    let mut passages = Vec::with_capacity(references.len());
    for reference in references {
        let ordinal = reference.book.ordinal;
        let code = reference.book.code;
        let mut from = reference.start_key();
        // A passage that begins inside a bridge begins with the bridge's verse.
        if let Some(start) = reference.start.verse {
            let bridged: Option<i64> = conn
                .query_row(
                    "SELECT t.verse_id FROM bible_verse_texts t JOIN bible_verses v ON v.id = t.verse_id
                     WHERE t.translation_id = ?1 AND v.book_id = ?2 AND v.chapter = ?3
                       AND v.verse < ?4 AND t.bridge_end >= ?4
                     ORDER BY v.verse DESC LIMIT 1",
                    params![translation_id, ordinal, reference.start.chapter, start],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(key) = bridged {
                from = key;
            }
        }
        let verses = read
            .query_map(params![translation_id, from, reference.end_key()], |r| {
                let chapter: u16 = r.get(0)?;
                let verse: u16 = r.get(1)?;
                Ok(MaterialVerse {
                    canonical: format!("{code}.{chapter}.{verse}"),
                    chapter,
                    verse,
                    bridge_end: r.get(3)?,
                    title: None,
                    text: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut verses = verses;
        // A chapter taken from its beginning keeps its title (Psalm titles), as the reader shows it.
        for v in verses.iter_mut() {
            let from_start = v.verse == 1
                && (v.chapter > reference.start.chapter
                    || reference.start.verse.is_none_or(|s| s <= 1));
            if from_start {
                v.title = conn
                    .query_row(
                        "SELECT text FROM bible_superscriptions
                         WHERE translation_id = ?1 AND book_id = ?2 AND chapter = ?3",
                        params![translation_id, ordinal, v.chapter],
                        |r| r.get(0),
                    )
                    .optional()?;
            }
        }
        let mut have: std::collections::HashSet<(u16, u16)> = std::collections::HashSet::new();
        for v in &verses {
            for n in v.verse..=v.bridge_end.unwrap_or(v.verse).max(v.verse) {
                have.insert((v.chapter, n));
            }
        }
        let mut missing = Vec::new();
        for chapter in reference.start.chapter..=reference.end.chapter {
            let canon_last = canon::verse_count(reference.book, chapter).unwrap_or(0);
            let first = if chapter == reference.start.chapter {
                reference.start.verse.unwrap_or(1)
            } else {
                1
            };
            // A verse named beyond the canon's count is expected too: some Bibles number further.
            let end = if chapter == reference.end.chapter {
                reference.end.verse.unwrap_or(canon_last)
            } else {
                canon_last
            };
            for verse in first..=end {
                if !have.contains(&(chapter, verse)) {
                    missing.push(format!("{chapter}:{verse}"));
                }
            }
        }
        passages.push(MaterialPassage {
            canonical: reference.canonical(),
            verses,
            missing,
        });
    }
    Ok(MaterialScripture {
        translation_id: bible.id,
        name: bible.name,
        short_name: bible.short_name,
        copyright_notice: bible.copyright_notice,
        passages,
    })
}
