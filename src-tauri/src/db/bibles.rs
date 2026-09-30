//! Installed Bible translations: import commit, removal, reading, search.
//!
//! Removal deletes a translation's own rows (text, superscriptions, search
//! entries) and nothing else. Canonical structure (`bible_books`,
//! `bible_chapters`, `bible_verses`), study passage links, findings and
//! translation-independent annotations are untouched; annotations tied to
//! the removed wording keep their passage and lose only the translation link.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::{new_id, now};
use crate::domain::validate;
use crate::error::{AppError, AppResult};
use crate::scripture::canon;
use crate::scripture::import::StagedContent;
use crate::scripture::reference::{split_key, verse_key, ScriptureRef};
use crate::scripture::{
    BibleTranslation, ChapterText, CommitImport, PassageText, SearchHit, SearchResults,
    SearchScripture, VerseText,
};

const COLUMNS: &str = "id, name, short_name, language, language_code, publisher, \
    copyright_notice, license_type, kind, source_type, source_origin, source_path, \
    original_file_name, import_status, is_builtin, book_count, verse_count, created_at, updated_at";

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
        return Err(AppError::Import(
            "This Bible has problems that must be resolved before it can be added.".into(),
        ));
    }
    let name = validate::title(&meta.name, "Bible")?;
    let short_name = validate::title(&meta.short_name, "Bible's short name")?;
    if short_name.chars().count() > SHORT_NAME_MAX_CHARS {
        return Err(AppError::InvalidInput(format!(
            "Please keep the short name under {SHORT_NAME_MAX_CHARS} characters."
        )));
    }
    let language = validate::title(&meta.language, "language")?;
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM bible_translations WHERE short_name = ?1 COLLATE NOCASE)",
        [&short_name],
        |r| r.get(0),
    )?;
    if taken {
        return Err(AppError::DuplicateTranslation(short_name));
    }
    let optional = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };

    let now = now();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO bible_translations
             (id, name, short_name, language, language_code, publisher, copyright_notice,
              license_type, kind, source_type, source_origin, source_path, original_file_name,
              import_status, is_builtin, book_count, verse_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'structured', ?9, ?10, ?11, ?12, 'ready',
                 ?13, ?14, ?15, ?16, ?16)",
        params![
            id,
            name,
            short_name,
            language,
            optional(&meta.language_code),
            optional(&meta.publisher),
            optional(&meta.copyright_notice),
            optional(&meta.license_type),
            source.format,
            source.origin,
            source.path,
            source.original_file_name,
            source.is_builtin,
            content.books.len() as i64,
            content.verse_count() as i64,
            now
        ],
    )?;
    {
        let mut add_verse = tx.prepare(
            "INSERT OR IGNORE INTO bible_verses (id, book_id, chapter, verse) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut add_text = tx.prepare(
            "INSERT INTO bible_verse_texts (translation_id, verse_id, text) VALUES (?1, ?2, ?3)",
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
                    add_text.execute(params![id, key, words])?;
                }
                if let Some(title) = &text.superscription {
                    add_title.execute(params![id, ordinal, chapter, title])?;
                }
            }
        }
    }
    tx.commit()?;
    log::info!(
        "Bible added: {short_name} ({} books, {} verses)",
        content.books.len(),
        content.verse_count()
    );
    get(conn, id)
}

/// Removes a translation's own data. Returns what was removed so the caller
/// can delete Abiding Word's managed copy of the source files.
pub fn remove(conn: &Connection, id: &str) -> AppResult<BibleTranslation> {
    let translation = get(conn, id)?;
    let tx = conn.unchecked_transaction()?;
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

pub fn chapter(
    conn: &Connection,
    translation_id: &str,
    book: &str,
    chapter: u16,
) -> AppResult<ChapterText> {
    get(conn, translation_id)?;
    let book = canon::by_code(book).ok_or_else(|| {
        AppError::InvalidReference(format!("“{book}” is not a book of the Bible."))
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
        return Err(AppError::InvalidInput(
            "Type a word or phrase to search for.".into(),
        ));
    };
    if let Some(id) = &input.translation_id {
        get(conn, id)?;
    }
    let range = match input.book.as_deref().filter(|b| !b.is_empty()) {
        Some(code) => {
            let book = canon::by_code(code).ok_or_else(|| {
                AppError::InvalidReference(format!("“{code}” is not a book of the Bible."))
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
