# Abiding Word — Scripture v0.2 implementation notes

How the first Scripture engine is built (Phase 2 in
[`architecture.md`](architecture.md) §58). The frozen
[`architecture.md`](architecture.md) and [`concept.md`](concept.md) remain
the authority; Foundation details are in
[`foundation-v0.1.md`](foundation-v0.1.md).

## Principle

Scripture is a first-class domain, not a source document (architecture §6).
Everything the user attaches to Scripture — study passages, notes,
highlights, bookmarks, later findings and citations — points at a
**canonical reference** that belongs to no translation. Translations are
interchangeable text layers over that canonical structure.

## Canonical identifiers

| Level | Form | Example |
|---|---|---|
| Book | three-character code | `JHN` |
| Verse | `BOOK.C.V` | `JHN.15.7` |
| Verse range | `BOOK.C.V-BOOK.C.V` | `JHN.15.1-JHN.15.11` |
| Chapter | `BOOK.C` | `ROM.8` |
| Chapter range | `BOOK.C-BOOK.C` | `JHN.14-JHN.16` |
| Mixed | allowed | `JHN.15.1-JHN.16.4`, `JHN.15-JHN.16.4` |

A reference stays within one book. Every verse also has a stable integer
**verse key** `BBCCCVVV` (book ordinal × 1 000 000 + chapter × 1 000 +
verse; `JHN.15.7` = `43015007`), used as `bible_verses.id` and for range
queries.

Book codes are those of the frozen architecture (`GEN`, `JHN`, `ROM` …),
which are the standard USFM/Paratext identifiers. The registry
(`src-tauri/src/scripture/canon.rs`) holds the 66-book Protestant canon in
English versification: ordinal, code, testament, English name, chapter
count (929 OT + 260 NT = 1 189 chapters), English aliases.

| Ord | Code | Book | Ch | | Ord | Code | Book | Ch |
|---|---|---|---|---|---|---|---|---|
| 1 | GEN | Genesis | 50 | | 34 | NAM | Nahum | 3 |
| 2 | EXO | Exodus | 40 | | 35 | HAB | Habakkuk | 3 |
| 3 | LEV | Leviticus | 27 | | 36 | ZEP | Zephaniah | 3 |
| 4 | NUM | Numbers | 36 | | 37 | HAG | Haggai | 2 |
| 5 | DEU | Deuteronomy | 34 | | 38 | ZEC | Zechariah | 14 |
| 6 | JOS | Joshua | 24 | | 39 | MAL | Malachi | 4 |
| 7 | JDG | Judges | 21 | | 40 | MAT | Matthew | 28 |
| 8 | RUT | Ruth | 4 | | 41 | MRK | Mark | 16 |
| 9 | 1SA | 1 Samuel | 31 | | 42 | LUK | Luke | 24 |
| 10 | 2SA | 2 Samuel | 24 | | 43 | JHN | John | 21 |
| 11 | 1KI | 1 Kings | 22 | | 44 | ACT | Acts | 28 |
| 12 | 2KI | 2 Kings | 25 | | 45 | ROM | Romans | 16 |
| 13 | 1CH | 1 Chronicles | 29 | | 46 | 1CO | 1 Corinthians | 16 |
| 14 | 2CH | 2 Chronicles | 36 | | 47 | 2CO | 2 Corinthians | 13 |
| 15 | EZR | Ezra | 10 | | 48 | GAL | Galatians | 6 |
| 16 | NEH | Nehemiah | 13 | | 49 | EPH | Ephesians | 6 |
| 17 | EST | Esther | 10 | | 50 | PHP | Philippians | 4 |
| 18 | JOB | Job | 42 | | 51 | COL | Colossians | 4 |
| 19 | PSA | Psalms | 150 | | 52 | 1TH | 1 Thessalonians | 5 |
| 20 | PRO | Proverbs | 31 | | 53 | 2TH | 2 Thessalonians | 3 |
| 21 | ECC | Ecclesiastes | 12 | | 54 | 1TI | 1 Timothy | 6 |
| 22 | SNG | Song of Songs | 8 | | 55 | 2TI | 2 Timothy | 4 |
| 23 | ISA | Isaiah | 66 | | 56 | TIT | Titus | 3 |
| 24 | JER | Jeremiah | 52 | | 57 | PHM | Philemon | 1 |
| 25 | LAM | Lamentations | 5 | | 58 | HEB | Hebrews | 13 |
| 26 | EZK | Ezekiel | 48 | | 59 | JAS | James | 5 |
| 27 | DAN | Daniel | 12 | | 60 | 1PE | 1 Peter | 5 |
| 28 | HOS | Hosea | 14 | | 61 | 2PE | 2 Peter | 3 |
| 29 | JOL | Joel | 3 | | 62 | 1JN | 1 John | 5 |
| 30 | AMO | Amos | 9 | | 63 | 2JN | 2 John | 1 |
| 31 | OBA | Obadiah | 1 | | 64 | 3JN | 3 John | 1 |
| 32 | JON | Jonah | 4 | | 65 | JUD | Jude | 1 |
| 33 | MIC | Micah | 7 | | 66 | REV | Revelation | 22 |

Rust: `ScriptureRef` (`scripture/reference.rs`) validates on construction;
`from_canonical`, `canonical()`, `display()` and `to_dto()` convert between
the forms. TypeScript: `ScriptureRef` (`src/types/scripture.ts`) carries the
canonical string plus its parts; `src/lib/scripture.ts` reads canonical
strings and applies the same display rules. The native core validates every
reference it receives; the frontend never sends free text where a
reference is expected.

## Database (migration 0002)

| Table | Holds |
|---|---|
| `bible_books` | the 66 books (seeded; a test keeps it equal to the registry) |
| `bible_chapters` | 1 189 canonical chapters |
| `bible_verses` | canonical verses, id = verse key; added the first time any translation supplies a verse, never deleted |
| `bible_translations` | installed translations and their metadata |
| `bible_verse_texts` | one row per translation × verse |
| `bible_superscriptions` | Psalm titles and similar lines before verse 1 |
| `bible_verse_search` | SQLite FTS5 index over verse text (external content, kept in step by triggers) |
| `annotations` | rebuilt: canonical `passage` plus verse-key range, optional `translation_id` |

Translation metadata: `name`, `short_name` (unique, case-insensitive),
`language`, `language_code`, `publisher`, `copyright_notice`,
`license_type`, `kind`, `source_type` (format), `source_origin`,
`source_path`, `original_file_name`, `import_status`, `is_builtin`,
counts and timestamps. Canonical book data is never copied per translation.

**Why annotations were rebuilt.** In 0001 an annotation had to point at a
`passage_references` row, and every such row must belong to a study, block
or finding, so a note on a verse outside a study was impossible
(architecture §20 requires it). 0002 creates the new table, copies existing
rows (converting their passage to canonical form) and replaces the old one.
Released migration 0001 is unchanged.

Upgrades use the Foundation safety path: integrity check, verified backup
to `backups/pre-migration/`, then migration (tested: v1 database with
studies and an old annotation upgrades, data intact, backup readable; a
blocked backup leaves the database at v1).

## Import

```text
choose files → detect format → parse → normalise → validate → preview
            → confirm → commit (one transaction)
```

- **Adapters.** `BibleImportAdapter` (`scripture/import.rs`) turns source
  files into normalised book/chapter/verse content. v0.2 ships
  **`UsfmAdapter`**: loose `.usfm`/`.sfm`/`.ptx` files or a `.zip` of them.
  USFM came first because it is plain text with one book per file, it is
  the format freely licensed Bibles are most often distributed in
  (eBible.org, Paratext), and its book identifiers are exactly our
  canonical codes. OSIS, USX (XML), EPUB, PDF, Word and HTML files are
  recognised and refused with a plain message; they become further adapters.
- **Reading USFM** (`scripture/usfm.rs`). Keeps the words; drops
  footnotes, cross-references, word attributes (Strong's numbers),
  headings, titles and introductions. Psalm titles (`\d`) are kept as
  superscriptions. Paragraph and poetry breaks become spaces.
- **Staging.** The parsed content is held in memory (`StagedImport`, one
  at a time) until the user confirms or cancels. Nothing touches the
  database before "Add this Bible".
- **Validation** (plain-language messages, grouped on the verification
  screen): unknown book (left out), invalid chapter, unreadable verse
  number, duplicate verse, verse before any chapter, missing file book id
  → **errors, block the import**; missing verses, missing chapters, empty
  verse text → **warnings**; combined (bridged) verses, files outside the
  66 books (introductions, glossaries, deuterocanonical books) → **notes**.
- **Commit** writes the translation, canonical verses, text and titles in
  a single transaction; any failure leaves nothing behind (tested with a
  forced mid-transaction failure).

### File ownership

| Source | What Abiding Word stores | On removal |
|---|---|---|
| Included Bible | text in the database; source stays in the app's resources | text deleted |
| User's files | text in the database **and** its own copy of the files in `sources/bibles/<translation id>/` | text and Abiding Word's copy deleted |

The user's original file is never modified, moved or deleted. Paths in the
database are relative to the data folder or name a bundled resource.

### Structured Bible vs Bible Document

`bible_translations.kind` is `structured` (mapped to book/chapter/verse:
navigation, lookup, comparison, linking, search) or `document` (a Bible
file kept and readable as a document but not mapped), with
`import_status` `ready` or `document_only`. v0.2 creates only structured
Bibles; the document kind exists in the model so unreliable sources are
never forced into a fake structure. Document ingestion belongs to the
library phase.

## Removing a translation

Deletes that translation's text, titles and search entries (and Abiding
Word's copy of user files) after confirmation. Kept: canonical structure,
study passage links, findings, notes, highlights and bookmarks. A note that
was tied to that translation's wording keeps its passage and loses only the
translation link. If it was the active translation, the setting is cleared.

## Reference parser and detection

`scripture/parser.rs`, deterministic, no AI. One regular expression is
built from an **alias dictionary**; English is the first dictionary. A new
language adds a dictionary of book names and abbreviations and reuses the
rest.

Parsing (typed navigation, study passages) accepts forms such as
`John 15`, `John 15:7`, `John 15:1-11`, `Jn 15:7`, `Rom 8:1-17`,
`1 Cor 13:4-7`, `1Cor 13`, `I John 3:16`, `First John 3:16`, `Psalm 23`,
`Ps 23`, `Rom. 8:1–17`, `Rom 8.28`, `John 14-16`, `John 15:1-16:4`,
`Jude 3` (one-chapter books read a single number as a verse), and a bare
book name (`Romans` → chapter 1).

Detection (`detect`) finds references in running text and returns the
matched text, UTF-16 start/end offsets (JavaScript string indexes) and the
canonical reference. A candidate counts only if its book name starts with a
capital letter or a digit and it is a real passage, so "we will mark 4
places" or "John 99:1" are not references. Very short aliases that are
common words ("is", "am", "Mr") are deliberately absent. Detection is used
in study text (links under each block); annotations and the import pipeline
come later.

## Reading, navigation and the active passage

`ScriptureProvider` (`src/features/scripture/ScriptureContext.tsx`) holds
the **active Scripture passage**: translation, book/chapter, and the
highlighted range. It is shared by the Scripture pane, the Study pane (study
passages, references in text) and is where future tools will read it. The
translation and passage are saved as settings (`scripture.translation`,
`scripture.passage`), so they survive a restart. Switching translation keeps
the canonical passage.

The reader fetches one chapter at a time (`scripture_get_chapter`); nothing
loads a whole translation into the interface.

## Annotations

Kinds: `note`, `highlight`, `bookmark`. Each stores the canonical passage
and its verse-key range; `translation_id` is optional and only set when a
note is about one translation's wording. The UI annotates single verses;
the model already supports ranges. Highlights and bookmarks are toggles (no
duplicates on the same passage). Deleting is a soft delete.

## Search

`scripture_search`: every word must occur (whole words, case and accent
insensitive; FTS5 `unicode61` tokenizer, no stemming); text in double quotes
must occur as a phrase. Filters: current translation or all, and book.
Results are in canonical order, at most 200. What the user types is turned
into a safe FTS query; FTS syntax has no effect.

## Commands

| Area | Commands |
|---|---|
| Scripture | `scripture_books`, `scripture_get_chapter`, `scripture_get_passage`, `scripture_search`, `scripture_reference_parse`, `scripture_reference_detect` |
| Bibles | `bible_list`, `bible_get`, `bible_bundled_list`, `bible_import_preview`, `bible_import_commit`, `bible_import_cancel`, `bible_remove` |
| Annotations | `annotation_list`, `annotation_create`, `annotation_update`, `annotation_delete` |
| Study passages | `study_passage_list`, `study_passage_add`, `study_passage_remove` |

The only file paths the frontend sends are those the user picked in the
system open dialog (`tauri-plugin-dialog`, permission `dialog:allow-open`).
New error kinds: `invalidReference`, `importFailed`, `unsupportedFormat`,
`duplicateTranslation` (plus `notFound` for a missing Bible).

## Licensing

Only Bible text whose licence was verified from the publisher's own
statement is shipped. v0.2 bundles one: the **World English Bible**
(eBible.org `engwebp`, 66-book edition), public domain; source, date,
checksum and the licence text are in
`resources/scripture/engwebp/SOURCE.md`, with the publisher's `copr.htm`.
"World English Bible" is an eBible.org trademark; the importer does not
change the wording (it omits footnotes, cross-references and Strong's tags),
so the name is kept. It is added through the normal verification screen,
not installed silently. Test fixtures are invented placeholder text.

Imported Bibles stay on the user's computer; nothing is uploaded and no
network access is involved anywhere in the Scripture engine.

## Original languages (deferred)

No original-language tables yet. `OriginalText`, `Token`, `Lemma`,
`Morphology` and `LexicalId` (architecture §6, §9) will attach to
`bible_verses.id` (verse key) and `bible_books`, so tokens align with the
same canonical verses every translation uses.

## Known limitations

- **Versification**: English (KJV-tradition) only. A Bible using another
  numbering (e.g. Hebrew Malachi 3:19–24, Joel 4) reports "chapter does not
  exist" errors and cannot be added yet; versification mapping is future
  work.
- **Formats**: USFM only. No OSIS, USX, EPUB, PDF, text or Sword import.
- **Text shape**: paragraph and poetry line breaks are flattened; section
  headings are not shown; bridged verses (e.g. `\v 4-5`) are stored on the
  first verse.
- **Parser**: English only; one book per reference; lists (`John 3:16, 18`),
  `ff`, `vv.` and cross-book ranges are not understood; a capitalised word
  such as "Numbers 5" at the start of a sentence may be detected as a
  reference.
- **Search**: whole words only, no stemming or ranking, 200 results.
- **Annotations**: single-verse UI; one highlight colour; no annotation
  manager yet.
- **Import staging**: one pending import at a time, held in memory; a large
  Bible takes a few seconds to check.
