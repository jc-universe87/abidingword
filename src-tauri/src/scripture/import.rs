//! Bible import: choose file → detect format → parse → normalise →
//! validate → preview → confirm → commit.
//!
//! [`stage`] does everything up to the preview and returns a
//! [`StagedImport`] held in memory; nothing touches the database until the
//! user confirms and `db::bibles::commit_import` writes it in one
//! transaction. Cancelling simply drops the staged import.
//!
//! Formats are read by a [`BibleImportAdapter`]. v0.2 ships the USFM
//! adapter (loose `.usfm`/`.sfm` files or a `.zip` of them); OSIS, USX and
//! others slot in as further adapters. PDF, EPUB and similar files are
//! recognised and refused clearly rather than guessed at.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::canon::{self, Book, NON_CANONICAL_USFM_CODES};
use crate::scripture::usfm;

/// Refuse anything bigger: a full Bible in USFM is under 20 MB.
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

/// One text file handed to an adapter.
pub struct SourceText {
    pub name: String,
    pub text: String,
}

/// A format reader. Implementations turn source files into normalised
/// book/chapter/verse content plus the problems they noticed.
pub trait BibleImportAdapter {
    /// Short format name stored with the translation, e.g. "usfm".
    fn format(&self) -> &'static str;
    fn can_read(&self, file: &SourceText) -> bool;
    fn read(&self, files: &[SourceText], staged: &mut StagedContent);
}

pub struct UsfmAdapter;

impl BibleImportAdapter for UsfmAdapter {
    fn format(&self) -> &'static str {
        "usfm"
    }

    fn can_read(&self, file: &SourceText) -> bool {
        file.text
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with("\\id ")
    }

    fn read(&self, files: &[SourceText], staged: &mut StagedContent) {
        for file in files {
            let doc = usfm::parse(&file.text);
            if !doc.unknown_markers.is_empty() {
                log::info!(
                    "import: {} uses unrecognised markers (ignored): {}",
                    file.name,
                    doc.unknown_markers.join(", ")
                );
            }
            let Some(code) = doc.book_code.clone() else {
                staged.issue(
                    Severity::Error,
                    None,
                    None,
                    UserMessage::new(
                        "bibleImport.noBookId",
                        format!(
                            "The file “{}” does not say which book it contains.",
                            file.name
                        ),
                    )
                    .with("fileName", &file.name),
                );
                continue;
            };
            let Some(book) = canon::by_code(&code) else {
                if NON_CANONICAL_USFM_CODES.contains(&code.as_str()) {
                    staged.skipped_files.push(file.name.clone());
                } else {
                    staged.issue(
                        Severity::Warning,
                        None,
                        None,
                        UserMessage::new(
                            "bibleImport.unknownBook",
                            format!(
                                "The file “{}” contains a book Abiding Word does not recognise ({code}). It was left out.",
                                file.name
                            ),
                        )
                        .with("fileName", &file.name)
                        .with("code", &code),
                    );
                }
                continue;
            };
            if staged.books.contains_key(&book.ordinal) {
                staged.issue(
                    Severity::Error,
                    Some(book),
                    None,
                    UserMessage::new(
                        "bibleImport.bookTwice",
                        format!("{} appears in more than one file.", book.name),
                    )
                    .with("bookCode", book.code),
                );
                continue;
            }
            let mut content = StagedBook::default();
            if doc.verses_outside_chapter > 0 {
                staged.issue(
                    Severity::Error,
                    Some(book),
                    None,
                    UserMessage::new(
                        "bibleImport.versesBeforeChapter",
                        format!(
                            "{}: some verses appear before the first chapter.",
                            book.name
                        ),
                    )
                    .with("bookCode", book.code),
                );
            }
            for verse in doc.verses {
                staged.add_verse(book, &mut content, &verse.chapter, &verse.label, verse.text);
            }
            for (chapter, text) in doc.superscriptions {
                if let Ok(number) = chapter.parse::<u16>() {
                    if (1..=book.chapter_count).contains(&number) {
                        content.chapters.entry(number).or_default().superscription = Some(text);
                    }
                }
            }
            staged.books.insert(book.ordinal, content);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Blocks the import.
    Error,
    /// Worth reviewing; the import can go ahead.
    Warning,
    /// For information only.
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub severity: Severity,
    pub book: Option<&'static str>,
    pub chapter: Option<u16>,
    /// Plain English; the interface shows `code` translated (docs/i18n.md).
    pub message: String,
    pub code: Option<String>,
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Default)]
pub struct StagedChapter {
    pub verses: BTreeMap<u16, String>,
    pub superscription: Option<String>,
}

#[derive(Debug, Default)]
pub struct StagedBook {
    pub chapters: BTreeMap<u16, StagedChapter>,
}

/// Normalised, validated content waiting for confirmation.
#[derive(Debug, Default)]
pub struct StagedContent {
    pub books: BTreeMap<u8, StagedBook>,
    pub issues: Vec<ImportIssue>,
    pub skipped_files: Vec<String>,
}

impl StagedContent {
    fn issue(
        &mut self,
        severity: Severity,
        book: Option<&'static Book>,
        chapter: Option<u16>,
        message: UserMessage,
    ) {
        self.issues.push(ImportIssue {
            severity,
            book: book.map(|b| b.code),
            chapter,
            code: message.code.map(String::from),
            params: message
                .params
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
            message: message.text,
        });
    }

    fn add_verse(
        &mut self,
        book: &'static Book,
        content: &mut StagedBook,
        chapter: &str,
        label: &str,
        text: String,
    ) {
        let name = book.name;
        let Ok(chapter) = chapter.parse::<u16>() else {
            self.issue(
                Severity::Error,
                Some(book),
                None,
                UserMessage::new(
                    "bibleImport.badChapterNumber",
                    format!("{name}: the chapter number “{chapter}” could not be read."),
                )
                .with("bookCode", book.code)
                .with("label", chapter),
            );
            return;
        };
        if chapter == 0 || chapter > book.chapter_count {
            self.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.chapterOutOfRange",
                    format!(
                        "{name} {chapter}: {name} has {} chapter{} in the standard numbering.",
                        book.chapter_count,
                        if book.chapter_count == 1 { "" } else { "s" }
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("count", book.chapter_count),
            );
            return;
        }
        // "4", or a bridge such as "4-5" (stored on its first verse).
        let (first, last) = match label.split_once(['-', '–']) {
            Some((a, b)) => (a.parse::<u16>().ok(), b.parse::<u16>().ok()),
            None => (label.parse::<u16>().ok(), None),
        };
        let Some(verse) =
            first.filter(|v| (1..=crate::scripture::reference::MAX_VERSE).contains(v))
        else {
            self.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.badVerseNumber",
                    format!("{name} {chapter}: the verse number “{label}” could not be read."),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("label", label),
            );
            return;
        };
        if let Some(last) = last {
            if last <= verse {
                self.issue(
                    Severity::Error,
                    Some(book),
                    Some(chapter),
                    UserMessage::new(
                        "bibleImport.badVerseNumber",
                        format!("{name} {chapter}: the verse number “{label}” could not be read."),
                    )
                    .with("bookCode", book.code)
                    .with("chapter", chapter)
                    .with("label", label),
                );
                return;
            }
            self.issue(
                Severity::Note,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.bridged",
                    format!(
                        "{name} {chapter}:{verse}–{last} are combined into one verse in this translation."
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("first", verse)
                .with("last", last),
            );
        }
        let verses = &mut content.chapters.entry(chapter).or_default().verses;
        if verses.contains_key(&verse) {
            self.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.verseTwice",
                    format!("{name} {chapter}:{verse} appears twice."),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("verse", verse),
            );
            return;
        }
        if text.trim().is_empty() {
            self.issue(
                Severity::Warning,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.emptyVerse",
                    format!("{name} {chapter}:{verse} has no text."),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("verse", verse),
            );
        }
        verses.insert(verse, text);
    }

    /// Structure checks that need the whole book: missing chapters and
    /// gaps in verse numbering.
    fn check_structure(&mut self) {
        let mut found = Vec::new();
        for (ordinal, content) in &self.books {
            let Some(book) = canon::by_ordinal(*ordinal) else {
                continue;
            };
            let chapters: BTreeSet<u16> = content.chapters.keys().copied().collect();
            let missing: Vec<u16> = (1..=book.chapter_count)
                .filter(|c| !chapters.contains(c))
                .collect();
            if !missing.is_empty() && !chapters.is_empty() {
                found.push((
                    Severity::Warning,
                    book,
                    None,
                    with_list(
                        UserMessage::new(
                            "bibleImport.missingChapters",
                            format!(
                                "{}: {} of {} chapters found (missing: {}).",
                                book.name,
                                chapters.len(),
                                book.chapter_count,
                                list(&missing)
                            ),
                        )
                        .with("bookCode", book.code)
                        .with("found", chapters.len())
                        .with("count", book.chapter_count),
                        &missing,
                    ),
                ));
            }
            for (chapter, text) in &content.chapters {
                let Some(max) = text.verses.keys().max().copied() else {
                    found.push((
                        Severity::Warning,
                        book,
                        Some(*chapter),
                        UserMessage::new(
                            "bibleImport.noVerses",
                            format!("{} {chapter}: no verses were found.", book.name),
                        )
                        .with("bookCode", book.code)
                        .with("chapter", chapter),
                    ));
                    continue;
                };
                // Verses covered by a bridge ("4-5") are not missing.
                let gaps: Vec<u16> = (1..max).filter(|v| !text.verses.contains_key(v)).collect();
                if !gaps.is_empty() {
                    found.push((
                        Severity::Warning,
                        book,
                        Some(*chapter),
                        with_list(
                            UserMessage::new(
                                "bibleImport.missingVerses",
                                format!(
                                    "{} {chapter}: verse{} {} not found. The expected verse structure differs from this text.",
                                    book.name,
                                    if gaps.len() == 1 { "" } else { "s" },
                                    list(&gaps)
                                ),
                            )
                            .with("bookCode", book.code)
                            .with("chapter", chapter),
                            &gaps,
                        ),
                    ));
                }
            }
        }
        for (severity, book, chapter, message) in found {
            self.issue(severity, Some(book), chapter, message);
        }
        // Bridged verses leave a deliberate gap; drop the matching warning.
        let bridges: Vec<(Option<&str>, Option<u16>)> = self
            .issues
            .iter()
            .filter(|i| i.code.as_deref() == Some("bibleImport.bridged"))
            .map(|i| (i.book, i.chapter))
            .collect();
        self.issues.retain(|i| {
            !(i.code.as_deref() == Some("bibleImport.missingVerses")
                && bridges.contains(&(i.book, i.chapter)))
        });
        self.issues.sort_by_key(|i| i.severity);
    }

    pub fn has_errors(&self) -> bool {
        self.issues.iter().any(|i| i.severity == Severity::Error)
    }

    pub fn verse_count(&self) -> usize {
        self.books
            .values()
            .flat_map(|b| b.chapters.values())
            .map(|c| c.verses.len())
            .sum()
    }

    pub fn chapter_count(&self) -> usize {
        self.books.values().map(|b| b.chapters.len()).sum()
    }
}

/// Adds a number list for the interface: `numbers` (the first few,
/// comma-separated), `listed` (how many are shown) and `more` (how many
/// are left out).
fn with_list(message: UserMessage, numbers: &[u16]) -> UserMessage {
    let shown = numbers.len().min(LIST_SHOWN);
    message
        .with(
            "numbers",
            numbers[..shown]
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(", "),
        )
        .with("listed", numbers.len())
        .with("more", numbers.len() - shown)
}

const LIST_SHOWN: usize = 8;

fn list(numbers: &[u16]) -> String {
    let mut text = numbers
        .iter()
        .take(LIST_SHOWN)
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    if numbers.len() > LIST_SHOWN {
        text.push_str(&format!(" and {} more", numbers.len() - LIST_SHOWN));
    }
    text
}

/// Where the files came from; decides how the source is kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportOrigin {
    /// Shipped with Abiding Word (`id` from [`crate::scripture::bundled`]).
    Bundled { id: &'static str },
    /// Chosen by the user; copied into the data folder on commit.
    UserFiles,
}

/// A parsed, validated import waiting for the user's decision.
pub struct StagedImport {
    pub id: String,
    pub origin: ImportOrigin,
    pub files: Vec<PathBuf>,
    pub format: &'static str,
    pub content: StagedContent,
    pub suggested_name: String,
    /// The language the files' own metadata states (Digital Bible Library
    /// `metadata.xml`, Paratext `Settings.xml`), as a well-formed tag; never
    /// guessed from names or text.
    pub language_tag: Option<String>,
}

/// Metadata files read beside the USFM for the language they state.
fn is_metadata_file(name: &str) -> bool {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();
    base == "metadata.xml" || base == "settings.xml"
}

/// The language a Bible's own metadata states, when it is a well-formed tag
/// and all such files agree: DBL `metadata.xml` (`<language>` → `<bcp47>`,
/// `<ldml>` or `<iso>`) or Paratext `Settings.xml` (`<LanguageIsoCode>`). Only
/// these structured fields count; names, titles and text never do.
pub fn metadata_language(files: &[SourceText]) -> Option<String> {
    fn field<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
        let open = format!("<{tag}>");
        let start = text.find(&open)? + open.len();
        let end = start + text[start..].find('<')?;
        Some(text[start..end].trim())
    }
    let mut found: Vec<String> = Vec::new();
    for file in files.iter().filter(|f| is_metadata_file(&f.name)) {
        let tag = if let Some(at) = file.text.find("<language>") {
            let block = &file.text[at..];
            let block = &block[..block.find("</language>").unwrap_or(block.len())];
            ["bcp47", "ldml", "iso"]
                .iter()
                .find_map(|t| field(block, t).and_then(crate::scripture::language::normalise_tag))
        } else {
            field(&file.text, "LanguageIsoCode")
                .and_then(|code| code.split(':').next())
                .and_then(crate::scripture::language::normalise_tag)
        };
        if let Some(tag) = tag {
            found.push(tag);
        }
    }
    found.dedup();
    match found.as_slice() {
        [one] => Some(one.clone()),
        // None, or files that disagree: no guess.
        _ => None,
    }
}

/// Reads the given files, detects the format and stages the content.
pub fn stage(paths: &[PathBuf], origin: ImportOrigin) -> AppResult<StagedImport> {
    if paths.is_empty() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "import.noFiles",
            "Choose at least one file.",
        )));
    }
    let texts = read_sources(paths)?;
    let language_tag = metadata_language(&texts);
    let texts: Vec<SourceText> = texts
        .into_iter()
        .filter(|t| !is_metadata_file(&t.name))
        .collect();
    let adapters: [&dyn BibleImportAdapter; 1] = [&UsfmAdapter];
    let adapter = adapters
        .into_iter()
        .find(|a| texts.iter().any(|t| a.can_read(t)))
        .ok_or_else(|| {
            AppError::UnsupportedFormat(UserMessage::new(
                "bibleImport.unknownFormat",
                "These files are not in a Bible format Abiding Word can read yet. \
                 It currently reads USFM Bibles (.usfm or .sfm files, or a .zip of them).",
            ))
        })?;
    let readable: Vec<SourceText> = texts.into_iter().filter(|t| adapter.can_read(t)).collect();

    let mut content = StagedContent::default();
    adapter.read(&readable, &mut content);
    content.check_structure();
    if content.books.is_empty() && !content.has_errors() {
        return Err(AppError::Import(UserMessage::new(
            "bibleImport.noBooks",
            "No books of the Bible were found in these files.",
        )));
    }
    log::info!(
        "import staged: {} file(s), {} book(s), {} verse(s), {} issue(s)",
        paths.len(),
        content.books.len(),
        content.verse_count(),
        content.issues.len()
    );

    Ok(StagedImport {
        id: uuid::Uuid::new_v4().to_string(),
        origin,
        files: paths.to_vec(),
        format: adapter.format(),
        content,
        suggested_name: suggested_name(paths),
        language_tag,
    })
}

fn suggested_name(paths: &[PathBuf]) -> String {
    match paths {
        [single] => single
            .file_stem()
            .map(|s| s.to_string_lossy().replace(['_', '-'], " "))
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn unsupported(kind: &str) -> AppError {
    AppError::UnsupportedFormat(
        UserMessage::new(
            "bibleImport.formatNotYet",
            format!(
                "{kind} files can’t be imported as a structured Bible yet. Abiding Word currently \
                 reads USFM Bibles (.usfm or .sfm files, or a .zip of them)."
            ),
        )
        .with("format", kind),
    )
}

fn read_sources(paths: &[PathBuf]) -> AppResult<Vec<SourceText>> {
    let mut total: u64 = 0;
    let mut texts = Vec::new();
    for path in paths {
        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        match extension.as_str() {
            "pdf" => return Err(unsupported("PDF")),
            "epub" => return Err(unsupported("EPUB")),
            "doc" | "docx" | "odt" | "rtf" => return Err(unsupported("Word")),
            "html" | "htm" | "xhtml" => return Err(unsupported("Web page")),
            "xml" if is_metadata_file(&file_name(path)) => {}
            "xml" | "osis" | "usx" => return Err(unsupported("OSIS and USX")),
            _ => {}
        }
        let size = fs::metadata(path)
            .map_err(|e| AppError::filesystem(path, e))?
            .len();
        total += size;
        if total > MAX_TOTAL_BYTES {
            return Err(AppError::Import(UserMessage::new(
                "bibleImport.tooLarge",
                "These files are too large to be a single Bible.",
            )));
        }
        if extension == "zip" {
            texts.extend(read_zip(path, &mut total)?);
        } else {
            let bytes = fs::read(path).map_err(|e| AppError::filesystem(path, e))?;
            if is_metadata_file(&file_name(path)) {
                if let Ok(text) = String::from_utf8(bytes) {
                    texts.push(SourceText {
                        name: file_name(path),
                        text,
                    });
                }
                continue;
            }
            texts.push(SourceText {
                name: file_name(path),
                text: decode(&bytes, &file_name(path))?,
            });
        }
    }
    Ok(texts)
}

fn read_zip(path: &Path, total: &mut u64) -> AppResult<Vec<SourceText>> {
    let file = fs::File::open(path).map_err(|e| AppError::filesystem(path, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        AppError::Import(
            UserMessage::new(
                "bibleImport.badZip",
                format!(
                    "The file “{}” is not a readable .zip archive ({e}).",
                    file_name(path)
                ),
            )
            .with("fileName", file_name(path)),
        )
    })?;
    let mut texts = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| {
            AppError::Import(
                UserMessage::new(
                    "bibleImport.badZipPart",
                    format!("Part of “{}” could not be read ({e}).", file_name(path)),
                )
                .with("fileName", file_name(path)),
            )
        })?;
        let name = entry.name().to_string();
        let lower = name.to_ascii_lowercase();
        let metadata = is_metadata_file(&lower);
        if entry.is_dir()
            || !(lower.ends_with(".usfm")
                || lower.ends_with(".sfm")
                || lower.ends_with(".ptx")
                || metadata)
            || (metadata && entry.size() > 1024 * 1024)
        {
            continue;
        }
        *total += entry.size();
        if *total > MAX_TOTAL_BYTES {
            return Err(AppError::Import(UserMessage::new(
                "bibleImport.zipTooLarge",
                "This archive is too large to be a single Bible.",
            )));
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| {
            AppError::Import(
                UserMessage::new(
                    "bibleImport.badZipEntry",
                    format!("“{name}” inside the archive could not be read ({e})."),
                )
                .with("fileName", &name),
            )
        })?;
        if metadata {
            // Optional: unreadable metadata is no language, never a failed import.
            if let Ok(text) = String::from_utf8(bytes) {
                texts.push(SourceText { text, name });
            }
            continue;
        }
        texts.push(SourceText {
            text: decode(&bytes, &name)?,
            name,
        });
    }
    Ok(texts)
}

fn decode(bytes: &[u8], name: &str) -> AppResult<String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        AppError::Import(
            UserMessage::new(
                "library.notUtf8",
                format!("“{name}” is not saved as UTF-8 text, so it could not be read."),
            )
            .with("fileName", name),
        )
    })
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// What the verification screen shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub preview_id: String,
    pub format: &'static str,
    pub bundled: bool,
    pub suggested: SuggestedMetadata,
    pub book_count: usize,
    pub chapter_count: usize,
    pub verse_count: usize,
    pub books: Vec<PreviewBook>,
    pub issues: Vec<ImportIssue>,
    /// Files set aside because they are not one of the 66 books
    /// (introductions, glossaries, deuterocanonical books).
    pub skipped_files: Vec<String>,
    pub can_import: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedMetadata {
    pub name: String,
    pub short_name: String,
    pub language: String,
    pub language_code: String,
    pub publisher: Option<String>,
    pub copyright_notice: Option<String>,
    pub license_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBook {
    pub code: &'static str,
    pub name: &'static str,
    pub chapters: usize,
    pub verses: usize,
    /// "ok", "warning" or "error".
    pub status: &'static str,
}

impl StagedImport {
    pub fn preview(&self, mut suggested: SuggestedMetadata) -> ImportPreview {
        if suggested.language_code.is_empty() {
            if let Some(tag) = &self.language_tag {
                suggested.language_code = tag.clone();
            }
        }
        let books = self
            .content
            .books
            .iter()
            .filter_map(|(ordinal, content)| {
                let book = canon::by_ordinal(*ordinal)?;
                let worst = self
                    .content
                    .issues
                    .iter()
                    .filter(|i| i.book == Some(book.code))
                    .map(|i| i.severity)
                    .min();
                Some(PreviewBook {
                    code: book.code,
                    name: book.name,
                    chapters: content.chapters.len(),
                    verses: content.chapters.values().map(|c| c.verses.len()).sum(),
                    status: match worst {
                        Some(Severity::Error) => "error",
                        Some(Severity::Warning) => "warning",
                        _ => "ok",
                    },
                })
            })
            .collect();
        ImportPreview {
            preview_id: self.id.clone(),
            format: self.format,
            bundled: matches!(self.origin, ImportOrigin::Bundled { .. }),
            suggested,
            book_count: self.content.books.len(),
            chapter_count: self.content.chapter_count(),
            verse_count: self.content.verse_count(),
            books,
            issues: self.content.issues.clone(),
            skipped_files: self.content.skipped_files.clone(),
            can_import: !self.content.has_errors(),
        }
    }
}
