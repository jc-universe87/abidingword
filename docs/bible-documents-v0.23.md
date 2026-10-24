# Bibles from documents and the Study editor fit (v0.23)

v0.23 lets a Bible be added from an ordinary document — PDF, EPUB, Word
(`.docx`), Markdown or plain text — either **by book, chapter and verse**
(when its structure is recognised and confirmed) or **as a document to read**.
It also fixes the clipped last line of Korean text in the Study editor.

The user guide pages are
[Getting started → A Bible in a PDF, EPUB or Word document](guide/01-getting-started.md#a-bible-in-a-pdf-epub-or-word-document)
and [Reading the Bible → A Bible read as a document](guide/02-reading-the-bible.md#a-bible-read-as-a-document).
Windows acceptance steps: [windows-acceptance-v0.23.md](windows-acceptance-v0.23.md).

## 1. The Study editor fit (Part A)

**Cause.** The Study's text areas (`BlockEditor`, `EditableTitle`,
`TeachingField`) measured their height once from `scrollHeight` when their
text changed. Korean (and, less visibly, German) text often wraps differently
once the web font has loaded or the column width settles, and Korean glyphs
in the fallback font sit lower: the measured height was then one line, or a
fraction of a line, short, and `overflow: hidden` clipped the last line.

**Fix.** One hook, `src/hooks/useAutosize.ts`, used by all three:

- height = `max(rows × line height, ceil(scrollHeight + borders) + 1)` — never
  a fixed height, never a smaller font;
- measured again when the text changes, when the interface language changes,
  when the element's **width** changes (a `ResizeObserver` that ignores its
  own height changes, so it cannot loop), when web fonts finish loading
  (`document.fonts` `loadingdone`) and when a folded part is opened;
- the caret and the autosave are untouched (the hook only sets `style.height`).

`field-sizing: content` was tried and dropped: WebView2 rounded it about
0.1 px short, which is enough to clip. Tests: `tests/ui/autosize.test.tsx`.
Screenshots before and after (Korean, German, English, French, Spanish,
Portuguese; 760 px and 1440 px) were checked; the Windows step is in the
acceptance list.

## 2. One extraction engine (Part B)

Nothing here parses a PDF, EPUB or DOCX on its own. `scripture::documents`
reads every file with the **Sources library's adapters**
(`library::adapters::{pdf, epub, docx, markdown, text}`) — the same text
extraction, page locations, chapter structure, size limits and hostile-file
protection (per-entry size limits in EPUB/DOCX archives, paragraph, depth and
item limits) — and keeps
two views of the result:

- **segments**: the document's paragraphs with their page or section, as the
  library keeps them, for reading and searching;
- **units**: the lines of a PDF page or text file, or the paragraphs and
  headings of an EPUB/DOCX/Markdown file, each pointing to its segment, for
  the verse recogniser.

The adapters gained three small, shared additions: `pdf::read_pages` (pages
with their lines, used by the library's own PDF import as well),
`NewSegment.note` (a DOCX footnote or endnote is marked as a note) and
`library::original::verified_path` (a managed copy is opened only if it lies
inside its own folder). The Bible tables do not reference the library's
tables: a Bible document is not a library source and carries nothing a
citation needs.

The reader reuses the library's **viewers** unchanged (`PdfViewer`,
`EpubViewer` for EPUB and DOCX): `src/features/scripture/documentApi.ts`
gives them an `Api` whose reading calls open the Bible's document instead of
a library source. Only reading is redirected; marks, citations and reference
detection are not offered there.

## 3. Formats

| Chosen file | Read as | Original view | Text, search | Verses can be recognised |
|---|---|---|---|---|
| `.pdf` with a text layer | PDF | page by page (pdf.js) | yes | yes |
| `.pdf` of scanned pages | PDF, `ocr_required` | page by page | no (no OCR) | no |
| `.epub` | EPUB | formatted chapters | yes | yes |
| `.docx` | Word | formatted document | yes (notes kept apart) | yes |
| `.md`, `.markdown` | Markdown | its text | yes | yes |
| `.txt` | plain text | its text | yes | yes |
| `.txt` containing USFM markers | **USFM** (as before) | — | — | the USFM importer |
| `.usfm`, `.sfm`, `.zip`, OSHB OSIS, MorphGNT | as before (structured import) | — | — | — |
| `.doc`, `.odt`, `.rtf`, `.html` | refused with a plain message naming the formats that work | | | |

Several files form one Bible when they are all of one format; they are read
in natural name order (`2-Exodus` before `10-Joshua`). Documents and
Bible-format files cannot be mixed. Limits: 200 MB per file, 400 MB and
100 files per Bible.

## 4. Recognising books, chapters and verses (Part C)

`scripture::structure::recognise` reads the units in order. What counts as
evidence and what never does is stated at the top of `structure.rs`; in short:

- **Books** only from a whole heading or line, matched against the reference
  dictionaries of the six interface languages plus Hebrew and Greek (and
  common title forms: "The Gospel according to …", "Das erste Buch Mose",
  "ΚΑΤΑ ΙΩΑΝΝΗΝ"). A file name, a table of contents or a book named inside a
  sentence is never evidence.
- **Chapters** from a heading ("Chapter 3", "Kapitel 3", "Chapitre 3",
  "Capítulo 3", "3장", "제3장", "Psalm 23", "פרק ג", roman numerals), from a
  line reference ("3:1 …"), or from a large number starting a paragraph where
  the previous chapter is complete by the standard verse counts.
- **Verses** from numbers that continue the count, at a line start or after
  punctuation, or after a space for the very next verse only. Numbers glued
  to words, references ("3:16", "5,3"), and numbers after "chapter" or a book
  name are not verse numbers; rejected numbers are put back into the text
  exactly as they were.
- **Ambiguity is refused**: two equally good places for a verse, a book that
  starts twice, a verse longer than 2,500 characters (the structure was lost)
  — the chapter is an error, never guessed.
- **Left out and reported**: text before the first book, headings and notes
  sections inside chapters, page headers and page numbers repeated on most
  PDF pages. A Psalm title before verse 1 stays its title. Verse 1 without a
  number right after a heading is accepted and reported (not for Psalms,
  where it might be the title).

The result fills the same staged content every Bible import fills and goes
through the same structure checks (canon order, verse counts, gaps). The
preview reports books found with their chapters and pages, missing and
unexpected verses, what was left out with samples, and its uncertainty. The
person can **correct** a heading's book (or leave it out); the documents are
then read again with that choice. The by-verse option is offered only when no
error remains.

**Provenance.** Each recognised verse records its document, first and last
segment and pages (`bible_verse_origins`); `bible_verse_origin` returns it.
The text stored is exactly the document's text for that verse, whitespace
normalised.

## 5. Storage (migration 0019)

Additive only: `bible_documents` (the files, in reading order, with format,
SHA-256, size, extraction status, pages), `bible_document_segments` (text by
paragraph, page or section) with the full-text index
`bible_document_search`, and `bible_verse_origins`. A Bible added as a
document is a `bible_translations` row with `kind = 'document'`,
`status = 'document_only'` (allowed since migration 0002). Recognising its
verses later (`bible_document_add_verses`) turns it into an ordinary
structured Bible in one transaction, keeping its documents.

Files are copied to `sources/bibles/<translation id>/` before the database
transaction; if anything fails the copies are removed. Cancelling the review
writes nothing. Removing the Bible removes its rows (cascade) and its folder.
The upgrade from dev.42 (schema 18) is tested in
`tests/bible_documents.rs::a_dev42_database_upgrades_and_keeps_everything`.

## 6. Commands

`bible_import_preview` / `bible_import_correct` / `bible_import_commit`
(with `asDocument`) — the Add a Bible flow; `bible_documents`,
`bible_document_info`, `_read`, `_structure`, `_item`, `_segments`,
`_search` — reading; `bible_document_recognise`,
`bible_document_add_verses` — Look for verses; `bible_verse_origin`.
All are main-window only (`permissions/windows.toml`).

## 7. Tests

- Rust `tests/bible_documents.rs` (35): text with headings and verse lines;
  chapter headings in six languages; printed-Bible chapter numbers; line
  references; Markdown; Psalm titles; unnumbered verse 1; missing verses;
  equal places refused; numbers inside text; notes and headings left out;
  front matter; no book; lost numbers; Korean; Hebrew RTL with points; Greek
  titles; corrections; a book twice; a generated PDF with running heads and a
  verse across pages; a scanned PDF; a malformed PDF; EPUB; DOCX with
  footnotes; staging; USFM in `.txt`; mixing refused; commit by verse with
  origins; commit as document then add verses; failed commit leaves nothing;
  cancel writes nothing; scanned PDF as document; corrections re-read;
  dev.42 upgrade. All fixtures are invented text generated in the test.
- UI `tests/ui/bible-documents.test.tsx` (9): review wording, both ways of
  adding, reader, search, Scripture search leaving the document, corrections,
  scanned PDF, cancel, Look for verses, Settings.
- The existing USFM, OSHB and MorphGNT import tests run unchanged.

## 8. Limits

- **No OCR**: scanned PDFs are read page by page only.
- Verse recognition needs printed verse numbers. Bibles printed with only
  paragraph text, or with verse numbers drawn as images, stay documents.
- Two-column PDF layouts are read in the order the PDF's text extraction
  gives. Where that interleaves the columns, verse numbers fall out of order
  and are refused or reported (never moved to fit), so such a Bible is
  usually offered only as a document. Not yet tried on a real two-column
  Bible.
- Book names outside the six interface languages, Hebrew and Greek are not
  recognised (use the correction list).
- A document Bible has no word information, Strong's numbers or concordance
  entries until its verses are recognised.
