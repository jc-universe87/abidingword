# Abiding Word — Library v0.4 implementation notes

How the personal source library is built (Phase 4 in
[`architecture.md`](architecture.md): source ingestion, PDF, EPUB,
Markdown, metadata, provenance, FTS5, Bible-reference extraction). The
frozen [`architecture.md`](architecture.md) and [`concept.md`](concept.md)
remain the authority. Earlier milestones:
[`foundation-v0.1.md`](foundation-v0.1.md),
[`scripture-v0.2.md`](scripture-v0.2.md),
[`studies-v0.3.md`](studies-v0.3.md).

The Library is deterministic: no AI, no OCR, no network. Everything below
works offline on the user's own files.

## Model

```text
Source            what the user thinks of as "a book", "an article", "my notes"
 └─ SourceFile    the managed copy of the file it came from
     └─ SourceSegment   one paragraph-sized piece of its text, with provenance
         └─ source_passages   Bible references found in that piece
```

The tables come from migration 0001 and are extended by 0004.

### Source (`sources`)

Title, subtitle, author, publisher, edition, publication year, ISBN, DOI,
language, notes and a **source type**: `book`, `article`, `notes`,
`sermon`, `lecture`, `document`. The type defaults from the format (PDF
and EPUB → book, otherwise notes) and the user can change it before adding.

**Licence status** (`licence_status`) records what the user may do with
the file:

| Value | Shown as | Meaning |
|---|---|---|
| `private` (default) | My own copy — not to be shared | the user's own copy; never redistributed |
| `distributable` | May be shared | its licence allows sharing |
| `unknown` | Licence not known | not stated |

v0.4 only records this; nothing is shared or exported yet. It exists so a
later export or sync feature can refuse to pass on private material.

`content_hash` keeps the SHA-256 of the primary file. A removed source
keeps its row with `deleted_at` set (a *tombstone*, a record that says
"this existed"), so findings that cited it can still say what they cited.

### SourceFile (`source_files`)

The managed copy: relative path inside the data folder, `sha256`, size,
media type, `format` (`pdf`, `epub`, `markdown`, `text`), the original
file name and path (for information only), `is_primary` (one primary file
per source in v0.4), `page_count` (PDF) and `extraction_status`:

| Value | Meaning |
|---|---|
| `digital_text` | born-digital text (EPUB, Markdown, text) |
| `extracted_text` | text taken from a layout format (PDF) |
| `ocr_required` | no usable text layer (a scanned PDF); not importable in v0.4 |
| `ocr_text`, `user_corrected` | reserved for OCR and correction; not produced in v0.4 |

### SourceSegment (`source_segments`)

One paragraph (long paragraphs are split at sentence ends into pieces of
at most 1,500 characters). Migration 0004 rebuilds this table with an
explicit `seq INTEGER PRIMARY KEY` so the full-text index has a key that
never changes; `id` stays the UUID that findings and links use.

## Provenance rules

Each segment records only what its format really supplies. Nothing is
invented: a Markdown file has no pages, so its segments have none.

| Format | Recorded | Locator shown |
|---|---|---|
| PDF | `page_number` (1-based, physical page), paragraph on the page | `p. 152` |
| EPUB | chapter file, heading, `section_path` (e.g. `Chapter 3 › Grace`), paragraph | the section path |
| Markdown | `section_path` from the heading hierarchy, paragraph | the section path |
| Text | paragraph number | `¶ 12` |

`char_start` / `char_end` locate the paragraph in the extracted text of
its page or document. `locator` is the human-readable form, fixed at
import. PDF page *labels* (roman numerals in a preface, for example) are
not read in v0.4; `page_label` exists for them.

The reader opens a source at an exact segment (search results, passage
mentions and citations all carry the segment id), highlights and focuses
it, and loads text around it in windows of 150 segments, so a long book is
never loaded into the interface at once.

## Import adapters

Each format is an adapter behind one trait, `SourceImportAdapter`
(`src-tauri/src/library/adapters/`): it says which file extensions it
accepts and turns the file's bytes into metadata plus segments. Adding a
format (or OCR later) means adding an adapter; the import pipeline does
not change.

| Format | Extensions | How |
|---|---|---|
| PDF | `.pdf` | `lopdf` for metadata (Info title/author, catalogue language) and encryption; `pdf-extract` for the text of each page. Fewer than 25 letters per page on average → treated as scanned. Password-protected PDFs are refused with a plain message. |
| EPUB | `.epub` | reads `META-INF/container.xml` → the OPF package (title, creator, language, publisher, identifier; an ISBN is recognised) → the spine (reading order) → each XHTML chapter, walking headings and block elements; scripts, styles and `<head>` are skipped. |
| Markdown | `.md`, `.markdown` | `pulldown-cmark`; headings build the section path, the first level-1 heading suggests the title; paragraphs, list items and code blocks become segments; raw HTML is ignored. |
| Text | `.txt` | UTF-8 (a byte-order mark is tolerated); paragraphs are separated by blank lines; words hyphenated across lines are joined. |

The import runs in two steps, like Bible import:

1. **Preview** (`library_import_preview`): read and extract in memory,
   detect Bible references, check for a duplicate, and show the result:
   format, pages or chapters, "Text extracted successfully" or the
   problem, number of Bible references. Nothing is written.
2. **Add** (`library_import_commit`): copy the file into the data folder,
   then write the source, its file, its segments and its passage links
   **in one transaction**. If anything fails, the transaction is rolled
   back and the copied file is deleted; the library is unchanged.

Limits: files up to 200 MB; EPUB entries up to 20 MB each. Any other
extension is refused as an unsupported format. A scanned PDF gets:
"This PDF appears to contain scanned pages. OCR support is not available
yet."

## File management

Managed copies live under the data folder:

```text
sources/books/<source-id>/<safe file name>      PDF, EPUB
sources/notes/<source-id>/<safe file name>      Markdown, text
```

The user's original file is never changed or moved. The safe file name
keeps letters, digits, spaces and `._-()`, collapses runs of dots (so
`..` can never escape the folder), trims to 120 characters and renames
names Windows reserves (`CON`, `NUL`, …). The folder is named after the
source id, so two files with the same name never collide.

Removal deletes the source's segments (and with them their search entries
and passage links), marks the file and source deleted, and removes the
managed folder, but only after checking that the folder is inside
`sources/` and is named after that source.

## Duplicate detection

The SHA-256 of the file's bytes is compared with the files already in the
library. Identical bytes → the preview says "This file is already in your
library as …", and adding needs a deliberate "Add a second copy anyway".
The same text in a different file (another edition, a re-saved PDF) is not
recognised as a duplicate.

## Bible-reference detection

At import, every segment is run through the deterministic English
reference detector from Scripture v0.2 (`ReferenceParser::detect`). A
candidate counts only if its book name starts with a capital letter or a
digit (so "mark 4" in ordinary prose is not a reference) and it is a real
passage in the canon. Each match is stored in `source_passages` with its
canonical form (`JHN.15.4`), a verse-key range for fast overlap lookups,
the text as written ("John 15:4") and its position in the segment.

The Sources pane uses this: "Sources mentioning John 15" lists every
segment whose references overlap the passage or verse being read, and
opens the source at that segment.

## Library search

`library_search` is an SQLite FTS5 full-text index over segment text,
with the same tokenizer as the other indexes (`unicode61
remove_diacritics 2`, so "Jesu" finds "Jesú"). Words and "exact phrases"
use the same query rules as Scripture and study search. Results come in
pages of 50, ranked by relevance, each with the source's title and author,
the segment's locator and a snippet with the matches marked. Removed
sources never appear.

The index uses *external content* (it stores only the index, reading text
from `source_segments`) and is kept in step by database triggers on
insert, update and delete. Tests run FTS5's own `integrity-check` with
`rank = 1`, which compares the index with the table row by row; plain
integrity checks and row counts cannot see stale entries, and a test that
removes the delete trigger confirms this check catches it.

Search is over segment text only. Titles and authors are shown and
filterable in the Library list but are not part of the full-text index.

In the interface, "Library" is the third, explicit scope in the app bar's
search, beside Scripture and Studies; the Library view has its own search
box too.

## Finding citations

`finding_sources` (from migration 0003) links a finding to a source and,
optionally, to the exact segment. v0.4 fills it:

- "+ Add source" on a finding searches the library; choosing a result
  cites that passage. Citing the same passage twice has no effect.
- Each citation stores a **snapshot**: `cited_title`, `cited_author` and
  `locator`. The chip reads "Author, Title, p. 152" and opens the reader
  at the cited place.
- A quotation finding can take the cited passage's text, but only when
  the user ticks "Also use the cited passage as this quotation's text".
  Citing never changes a finding's text otherwise.
- Removing a citation soft-deletes it.
- When a source is removed from the library, its citations stay. The
  segment link is cleared (the segment is gone), the source row is a
  tombstone, and the chip shows the snapshot with "(removed from library)"
  and no longer opens anything.
- Duplicating a study with its content copies the citations too.

## Copyright and private resources

The library is for material the user owns or may use. Abiding Word does
not ship, download or share any of it. Imported files and their text stay
in the data folder, which is outside the repository. The repository
contains no books: the tests generate small PDFs and EPUBs from invented
text at run time (`src-tauri/tests/support/library_fixtures.rs`), and the
interface tests use invented text in memory. See the README's "Never
commit private or imported material".

## Migration 0004

`0004_library.sql` adds the columns above, rebuilds `source_segments`
with `seq` (copying any existing rows), creates `library_search` with its
triggers, `source_passages`, and the citation snapshot columns. As with
every migration, the app checks the database's integrity and writes a
verified backup to `backups/pre-migration/` before applying it; if the
backup fails, nothing changes. `tests/migration_v4.rs` builds a v3
database with studies, findings, passages, tags, relations, templates, a
Bible and annotations, upgrades it, and checks that the backup exists and
all data survived.

## Commands

`library_list`, `library_languages`, `library_get_source`,
`library_import_preview`, `library_import_commit`,
`library_import_cancel`, `library_remove_source`, `library_search`,
`library_open_segment`, `source_get_segments`, `source_get_passages`,
`library_sources_for_passage`, `finding_source_add`,
`finding_source_remove`, `finding_source_list`. None exposes a file path
to read or SQL; the only file the interface names is the one the user
chose in the system file dialog.

## Known limitations

- No OCR: scanned PDFs are recognised and refused, not read.
- PDF text comes out in the order `pdf-extract` finds it. Multi-column
  layouts, footnotes and running headers may be interleaved with the main
  text; hyphenation is joined only at line ends.
- PDF page labels (i, ii, …) are not read; locators use physical pages.
- Reference detection understands English book names only, and does not
  resolve partial references ("v. 4", "ch. 3") from context.
- Full-text search does not include titles or authors.
- Metadata can be edited only when adding a source.
- One file per source; a second edition is a second source.
- A citation is chosen by searching; the reader has no "cite this
  paragraph" button yet.
- Very large sources are imported in one transaction and one pass;
  there is no progress bar for a slow PDF.

## Extension points (not built)

- **OCR** — a new adapter (or a step after the PDF adapter) that fills
  segments for `ocr_required` files and marks them `ocr_text`;
  `user_corrected` is reserved for corrected text.
- **Transcription** (sermon audio, lectures) — another adapter producing
  segments whose locator is a time stamp.
- **AI** (Phase 5) — can read segments, their provenance and passage links
  through the existing commands; embeddings would sit beside the FTS index,
  not replace it. Any AI answer quoting the library can cite a segment id,
  so its provenance can be checked in the reader.
- **Export and sync** — `licence_status` is the hook for refusing to pass
  on private material.
