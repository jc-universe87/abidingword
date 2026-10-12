# Library reading and the interactive Original PDF (v0.13)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Your library](guide/05-library.md)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

Status: merged into `main` (`d8d2ecd`), with the v0.13.1 and v0.13.2 fixes
(`f7e4577`, `2732029`), and accepted on Windows (test build `0.5.0-dev.29`).
To be tagged `library-reading-v0.13` at `2732029`. Built on the branch
`claude/beautiful-curie-vm0eve` from `main` `76145c3`.
**No database migration.** Deterministic only: no AI, no embeddings, no
semantic matching, no OCR.

## Scope

| Part | What it adds |
|---|---|
| 1. Find in this source | A find bar in the library reader: every place a word or words occur in *this* source, with Previous / Next |
| 2. Generated contents | A table of contents made from the source's own headings, for a source that carries none, always labelled as generated |
| 3. EPUB character references | Every HTML character reference (`&bull;`, `&#8212;`, `&nbsp;`…) decoded once, the same in Reading and Original |
| 4. Interactive Original PDF | Scripture references on the PDF page itself, find marks there, a notice on pages without text, the view remembered per source |

## 1. Find in this source

**Where:** the **Find** button in the reader's toolbar (Sources pane and full
reader), or **Ctrl+F** (⌘F) while focus is in the reader. It is separate from
the app bar's Library search, which searches every source.

**Matching** (`src-tauri/src/library/find.rs`), deterministic and forgiving
only in the ways a find box should be:

- case is ignored (Unicode lowercase);
- accents and other combining marks are ignored (canonical decomposition,
  marks dropped): *rom* finds *Röm*, *λογος* finds *λόγος*, Hebrew points are
  not needed;
- Greek final sigma counts as sigma;
- Hangul syllables are compared whole, so a query never matches half a
  syllable;
- any run of whitespace (a non-breaking space included) counts as one space.

**Deliberately different from the Concordance (v0.12).** Find is forgiving
document navigation: accents are ignored in every script and a query matches
inside words (*remain* finds *Remaining*, *romer* finds *Römer*). The
Concordance is exact Bible occurrence analysis: whole words only, and Latin
accents stay meaningful (*é* ≠ *e*, *über* ≠ *uber*); only Greek accents and
Hebrew points are set aside there. Neither is changed to match the other.

A match never spans two segments; matches do not overlap. Ranges are UTF-16
offsets into the stored segment text (the interface's string offsets).

**Backend:** `library_source_find(id, query)` →
`SourceFind { matches: [SourceMatch { position, pageNumber, start, end }], total, truncated }`,
segments read in reading order straight from `source_segments`; the book is
never loaded into React. Bounds: at most **2,000** matches returned and
**10,000** counted (`truncated` says the bound was reached); queries over 200
characters find nothing.

**Interface** (`src/features/library/FindBar.tsx`, `SourceReader.tsx`):

- The search runs 300 ms after typing pauses, or at once on **Enter**.
- **Enter** = next, **Shift+Enter** = previous (both wrap), plus Previous /
  Next buttons. **Escape** or Close shuts the bar, removes the marks and gives
  focus back to the Find button. The query is kept for the next opening.
- The count ("3 of 12", "1 of more than 10,000", "No matches") is a polite
  live region.
- Every match in view is marked; the current one is bolder and outlined (not
  colour alone) and centred. Marks are drawn inside links and Scripture
  references without breaking them.
- Showing a match is **not** a jump: Back / Forward history is untouched, and
  the Study (its primary passage) is never changed. Focus stays in the find
  bar while stepping.
- The query and current match carry across Reading ↔ Original. In an EPUB or
  Word Original the current match's document and paragraph are opened (no
  mark); in a PDF Original see Part 4.

## 2. Generated contents

The **Contents** panel shows the source's **own** contents when it has them
(an EPUB's navigation document or NCX, a PDF's outline). Only when it has none
does the core generate contents (`library_generated_contents`,
`src-tauri/src/library/generated_contents.rs`). The panel is then headed
**Generated contents** with the note *"Made from the headings found in this
source. It is not part of the original."* A source's own contents always win,
also when they arrive later (a PDF outline read by the open document replaces
generated contents).

| Format | Generated from |
|---|---|
| EPUB, Markdown | The headings the text is divided by (the stored section path, h1 › h2 › h3), first three levels; each entry leads to the first segment under the heading |
| Word (DOCX) | The Word headings (heading styles / outline levels), as before; a DOCX has no contents of its own, so these are now labelled generated |
| PDF | Probable headings, below |

**PDF rules** (precision over recall; if uncertain, omit). Evidence comes
from the text layer only (pdf-extract's drawing callbacks: each character's
size and position):

1. Lines are rebuilt from characters by baseline; each line's type size is
   the size most of its characters use. Rotated and vertical text is ignored.
2. **Running headers and footers** are removed: the same text (numbers
   aside) in the top or bottom 10% of three or more pages. Page numbers
   (digits, roman numerals, "Page 7") in those margins go too.
3. The **body size** is the size most characters are set in.
4. A line is a heading only if it is short (2–120 characters, ≤15 words, has
   letters, does not end in `,` `;` or a hyphen) **and** one of:
   - its type is at least 1.25× the body size;
   - it is numbered (`1.`, `1.2`, `1.2.3` then a word), at least 1.1× the
     body, with space above it (≥1.5 line heights) and ≤12 words;
   - it begins with a chapter word and a number — *Chapter / Kapitel /
     Chapitre / Capítulo / Part / Teil / Partie / Parte / Book / Buch / Livre
     / Libro / Livro / Section / Abschnitt / Lesson / Lektion / Leçon /
     Lección / Lição* + digits, roman numerals or a number word, or Korean
     *제 N 장/부/편/과* — at body size or larger, with clear space above
     (≥2 line heights) and ≤8 words.
5. A heading set over two or three lines (same size, close together) is one
   entry.
6. **Levels** by size: the largest heading size is level 1, the next 2, the
   next 3; smaller heading sizes are dropped.
7. **Noise guard:** fewer than two headings, or more than two per page (+10),
   gives no contents at all.

Entries lead to their physical page (`ContentsTarget::Page`, new in this
version); Reading shows that page's text, Original moves to the page, and the
jump is Back / Forward history as any contents entry is. PDFs over 3,000 pages
are not examined. Results are kept in memory for the session (eight sources);
nothing is stored, so there is **no schema change**. Bold type is not used as
evidence: pdf-extract does not report font weight to its drawing callbacks.

## 3. EPUB character references

> Since v0.13.1: a stray `&` no longer ends a document, and books imported by
> earlier versions have their text refreshed; see
> [`reference-context-v0.13.1.md`](reference-context-v0.13.1.md#1-epub-character-references).


`src-tauri/src/library/adapters/epub.rs` decodes character references in one
pass (`unescape`): all 2,125 HTML5 named references
(`adapters/html_entities.rs`, looked up by binary search), decimal and hex
numeric references (0x80–0x9F read as Windows-1252, as browsers do; 0,
surrogates and out-of-range values become U+FFFD), with unknown or malformed
references left exactly as written. One pass means no double decoding:
`&amp;bull;` reads `&bull;`. `&nbsp;` becomes U+00A0. Text already in Unicode
is untouched. The formatted (Original) view goes through the same sanitiser,
so both views read the same; tests cover named, numeric, escaped ampersands,
already-decoded text, links, emphasis and lists.

## 4. Interactive Original PDF

### Two representations, never merged

| | A. Imported text | B. Page-text map |
|---|---|---|
| What | The normalised text extracted at import (segments) | The page's text exactly as PDF.js draws it |
| Lives | In the database | Only while the page is on screen |
| Used for | Search, Find, the index, citations, Reading | Placing marks on the page |
| Made by | The core (pdf-extract) | PDF.js `getTextContent()` |

PDF.js is the geometry ground truth. For a page near the screen,
`PdfDocument.text()` reads the text content **once**, gives it to PDF.js's
`TextLayer` (which draws one span per text item, in order) and returns a
`PdfTextLayer`: the joined item strings (a line break after each item that
ends a line), each item's start, whether each item can carry a mark, and
`boxes(start, end)`, which measures a range on the drawn spans with DOM
ranges and returns boxes as shares of the page. Boxes are percentages, so they
stay on the words at any zoom.

An item can carry a mark only if it is upright, left-to-right, and in the
body of the page (not the top or bottom 6%, where running headers and footers
are). A range touching any other item is not marked at all. Nothing is
guessed: no OCR, no estimated coordinates, no fuzzy geometry.

### What the Original view does with it

- **Scripture references:** each page's drawn text is read for references in
  the source's language (`library_detect_references`, once per page,
  cached), and each one placed exactly becomes the same quiet **Open in
  Bible** action as in Reading (`ScriptureReference`): a dotted underline,
  a menu, Escape returns focus. It moves the Scripture pane with its own
  Back / Forward (v0.11); the Study's primary passage is never changed; the
  reader stays in Original. A reference broken over two lines is underlined
  on both and acted on through its first part. Right-to-left text (so Hebrew)
  and vertical text are never linked.
- **Pages without text:** a page whose text layer has no text shows *"Native
  text unavailable on this page"*. Nothing is recognised from the image.
- **Find:** the current match's page is opened. The match is marked on the
  page only when it can be mapped uniquely: the page's own text, folded the
  same way, has exactly as many occurrences as the imported text has on that
  page, so the n-th is the n-th. Otherwise the page opens unmarked.
- **Laziness:** only pages near the screen are drawn, mapped and read for
  references; pages far away are released, with their maps.

### Reader mode memory

The reader remembers **Reading** or **Original** per source on this computer
(browser storage key `abidingword.reader.mode.<sourceId>`). A source never
opened in Original opens in Reading; there is no global default. Continuing
from another reader (pane ↔ full reader) keeps that reader's view.

### PDF.js

`pdfjs-dist` is pinned exactly to **6.3.289** (`package.json`), and
`tests/unit/pdfjsPageText.test.ts` runs the real library on a PDF written by
the test, checking the item mapping, header and rotated-text exclusion, and a
page without text. Changing the version needs that test, the span-per-item
assumption and a Windows check.

## Accessibility

- Find: a `search` landmark, labelled field, live count, keyboard only (Enter,
  Shift+Enter, Escape), focus returned on close; the current match is shown by
  weight and outline as well as colour.
- Generated contents: the panel's heading says it is generated; the note is
  plain text.
- PDF references are real buttons with the reference as their name
  ("Romans 8:1 (Scripture reference)") and a menu, reachable by Tab.
- The no-text notice is a `note`.

## Performance

- Find reads segments in order and stops counting at 10,000; nothing is
  indexed in advance.
- Generated PDF contents read the whole file once per session per source
  (pdf-extract), off the interface thread; EPUB / Markdown contents come from
  one query over the stored section paths.
- PDF page-text maps and reference detection only for pages near the screen;
  one detection call per page, cached for the open document.

## Known limits

- Find counts at most 10,000 matches and steps through the first 2,000.
- Find marks in an EPUB / Word Original are not drawn (the paragraph is
  opened).
- Find marks on a PDF page need a unique mapping; hyphenation or ligatures
  that differ between the two texts mean the page opens unmarked.
- Generated PDF contents use type size, numbering and space; bold is not
  available as evidence. Unusual layouts (headings at body size without
  numbering) get no entry rather than a wrong one.
- A Word document's own TOC field is not read; its headings are used.
- References are not linked in right-to-left or vertical PDF text, in the
  top or bottom 6% of a page, or on pages without text.
- Within a long text item, a box can drift by a few points where the system
  font's glyph widths differ from the PDF's (PDF.js scales whole spans).

## Tests

- Rust: `library::find` unit tests; `tests/source_find.rs` (order, exact
  ranges, bounds, unknown source); `library::generated_contents` unit tests
  (sections, sizes and levels, headers/footers/page numbers, numbering and
  keywords, multi-line headings, noisy and flat documents);
  `tests/generated_contents.rs` (a real PDF through pdf-extract, a uniform
  PDF, Markdown through import); EPUB character references in
  `adapters::epub` and `tests/epub_view.rs`.
- Interface: `tests/ui/source-find.test.tsx`,
  `tests/ui/generated-contents.test.tsx`, `tests/ui/pdf-interactive.test.tsx`,
  `tests/unit/pdfPageText.test.ts`, `tests/unit/pdfjsPageText.test.ts`
  (real PDF.js), and the updated `tests/ui/formatted-docx.test.tsx`.

## Windows acceptance checklist

On the Windows test build, with a few real books (a PDF with an outline, a
PDF without one, a scanned PDF, an EPUB with and without a table of contents,
a Word document, a German and a Korean source):

**Find**
- [ ] Find opens from the toolbar and with Ctrl+F; the field has focus.
- [ ] A word's count is right; Enter / Shift+Enter / the arrows step and wrap.
- [ ] Case and accents are ignored (*rom* finds *Röm*); Korean matches whole syllables.
- [ ] Every match in view is marked; the current one is outlined and centred.
- [ ] Escape closes, removes the marks, returns focus to Find.
- [ ] Back / Forward and the Study's passage are unchanged after finding.
- [ ] The query carries over when switching Reading ↔ Original.

**Generated contents**
- [ ] A PDF with an outline shows **Contents** (its own), not generated ones.
- [ ] A PDF without an outline but with clear headings shows **Generated contents**, sensible, with the note.
- [ ] A PDF of plain text (or with noisy layout) shows no Contents button.
- [ ] An EPUB without a table of contents, a Markdown file and a Word document show generated contents from their headings.
- [ ] Entries open the right page / heading in Reading and Original; Back returns.
- [ ] All six interface languages show the generated label.

**EPUB characters**
- [ ] An EPUB with `&bull;`, dashes, quotes and non-breaking spaces reads the same in Reading and Original, with no `&…;` visible.

**Original PDF**
- [ ] References on PDF pages are underlined and offer **Open in Bible**; Scripture moves; Study unchanged; the reader stays in Original.
- [ ] A German PDF's *Joh 3,16* / *Mal 4,3* is linked; running headers are not.
- [ ] Underlines sit on the words at 50%, 100%, 200% and Fit page, and after scrolling away and back.
- [ ] A scanned page says "Native text unavailable on this page".
- [ ] Find in Original opens the page and marks the match when unique.
- [ ] Reopening a source opens it in the view last chosen for it; other sources open in Reading.
- [ ] A long PDF (300+ pages) stays smooth while scrolling.
