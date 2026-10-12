# Document annotations and source notes (v0.14)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Marking your books](guide/05-library.md#marking-your-books)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

Status: built on the branch `claude/beautiful-curie-vm0eve` from `main`
`2732029` (test build `0.5.0-dev.29`). Not merged, not tagged, no Windows build.
**Database migration 0006** (additive; backed up before it runs).
Deterministic only: no AI, no OCR.

## Scope

A person reading a commentary, a sermon manuscript, a PDF, an EPUB or a Word
document can mark it the way they would mark a printed book:

- **Highlight** selected text in one of the five quiet colours of the Bible's
  highlights (amber, green, blue, rose, grey).
- **Note** on selected text, or on a place (a paragraph, a PDF page) with no
  text selected.
- **Bookmark** a place.

Each mark is a way back to its place. Marks belong to the **source document**.
They are a separate model from Scripture annotations (v0.5), which belong to
canonical verses. The two share only the colour palette and its swatches.

Not in v0.14: freehand ink, OCR of scanned pages, collaboration, sync, AI
notes, editing the original file. The model leaves room for all of them
(see [Later](#later)).

## Model: one table, identity in the stored text

`source_annotations` (migration 0006), one row per mark:

| Column | Meaning |
|---|---|
| `id`, `workspace_id`, `source_id`, `source_file_id` | identity and owner |
| `kind` | `highlight`, `note`, `bookmark` (checked by the application, so a later kind needs no table rebuild) |
| `color` | highlights only |
| `content` | a note's words |
| `start_segment_id`, `start_offset`, `end_segment_id`, `end_offset` | **the anchor**: stored segments and UTF-16 offsets into their stored text (end exclusive); a place has a start segment and no offsets; `ON DELETE SET NULL` |
| `quote`, `prefix`, `suffix` | the selected stored text, and up to 32 characters before and after it |
| `position`, `page_number`, `locator`, `section_path` | where it was (order, fallback, display); never the identity |
| `anchor` | small format-specific JSON, versioned: today only `{v, page, fraction}` for a place on an Original PDF page |
| `anchor_state` | `exact`, `moved`, `unresolved` |
| `created_at`, `updated_at`, `deleted_at`, `revision` | as every table (soft delete) |

**Quote convention.** A selection across segments has one quote: the stored
texts joined with `"\n"`. The interface builds it and the core rebuilds and
checks it the same way (`library::annotations::Line`). A quote whose words do
not match the stored text is refused (`sourceAnnotations.textChanged`).
Offsets are UTF-16 (JavaScript string indexes) and never split a surrogate
pair. Selections are trimmed of white space at both ends.

**Why the stored text.** Segments are what search, citations and Scripture
links already use. They outlive views: they are the same in Reading, Original
PDF and formatted EPUB/DOCX, at every zoom, after restarting. No view owns a
mark's identity. A PDF rectangle or a DOM path is never stored.

The never-used `annotations.source_segment_id` (0001/0002) is superseded. The
migration copies any row that may carry it as a note on that paragraph and
leaves the column alone.

### Highlights behave like a highlighter on paper

As with Bible phrase highlights (v0.5), a new highlight owns exactly the words
it covers:

- same-colour highlights that overlap or touch it are merged into it;
- other colours are trimmed, split (the second half keeps the original's date)
  or removed where it covers them.

This runs in one transaction. Points are ordered as (reading position, UTF-16
offset). Highlights separated by a space do not touch, the same as in the Bible.
Recolouring is highlighting the same words again in the new colour, and keeps
the highlight's id. Notes are never merged. There is one bookmark per place.

## Finding a mark again (resolution)

Stored text can change under a segment id: the v0.13.1 EPUB text repair does
this. `db::source_annotations::resolve_source` finds every mark of a source
again. It runs when a source's marks are listed, and after a text repair.
It is deterministic, and the first step that succeeds wins:

1. **Exact:** its segments hold its quote at its offsets.
2. **Same segments:** the quote occurs once in the segments it was on (if
   several times, the stored context decides).
3. **Nearby:** the quote occurs within 20 paragraphs of where it was, and the
   context agrees.
4. **Same page or section:** as step 3, within that page or section.
5. **Whole source:** as step 3, anywhere in the source.
6. **A place** whose paragraph has gone: the first paragraph of its page or
   section.
7. **Otherwise unresolved:** the mark is kept, listed with its words, and
   never drawn.

**How the context decides.** Occurrences with the stored text on both sides
are preferred. If there are none, occurrences with it on one side count (the
other side may have changed). Exactly one such occurrence is a match; two or
more are **ambiguous**. Nothing is chosen by position or order.

**Ambiguity stops the search.** An ambiguous step leaves the mark unresolved at
once: a wider step could only be as ambiguous. A mark found again is rewritten
to its new place (`moved`). Its quote is unchanged by definition.

**What never touches marks.** Passage-index rebuilds never touch
annotations (tested). A place on an Original PDF page keeps its page: the file
never changes.

## Views

### Reading (all formats): the baseline

- **Paragraph identity.** Each paragraph carries `data-segment-id`.
- **Selecting words.**
  - A selection is read with `sourceSelection.ts`.
  - Only the source's own text is counted. A mark's button or an open
    reference menu is marked `data-aw-skip`.
  - A paragraph whose drawn text differs from its stored text is never
    anchored.
- **The strip.** When text is selected, a small strip offers **Highlight**
  (then a colour) and **Add note**.
- **Drawing.**
  - Highlighted words are drawn as `<mark>`. Noted words get a dotted
    underline.
  - A paragraph with marks has a named marker. It opens the paragraph's marks:
    recolour, edit, delete, remove.
- **The toolbar.**
  - **Bookmark this place** is a toggle with a pressed state.
  - **Add note here** writes a note on the paragraph the reader is at: the one
    last clicked or focused while in view, else the top of the view. It also
    offers **Highlight this paragraph**, the keyboard path to a highlight.

### Original PDF

The two representations of v0.13 are kept apart. Marks are anchored in the
imported text. PDF.js's page text only places them.

**`pdfTextMatch.ts`** places the stored paragraphs of a page on the drawn page
text.

- **Folding.** Both sides are folded the same way:
  - spaces and soft hyphens dropped;
  - a line-end hyphen before a lower-case letter dropped (as the import joins
    the word);
  - compatibility forms expanded (the `ﬁ` ligature);
  - case and accents ignored, Hangul kept whole.
- **Exactly once.** A paragraph is placed only where its folded text occurs
  exactly once. Two paragraphs over the same text are both dropped.

**Drawing.**

- A mark is drawn as boxes from `PdfTextLayer.boxes`. These are shares of the
  page, recomputed at every zoom.
- Only usable text carries a mark. Running headers and footers, and rotated or
  right-to-left text, never do.
- Each page lists the marks that begin on it with a marker. This includes marks
  that could not be drawn there.

**Selecting on the page.**

- `PdfTextLayer.offsetOf` turns a DOM point in PDF.js's text layer into a page
  text offset. `pageToStored` reads that range back into the stored text.
- Across paragraphs, the page must draw them in reading order and the
  selection must cover everything between its ends; otherwise (two columns,
  a float) it is not offered, rather than mark words that were not selected.
- Every selected character must belong to a placed paragraph. Otherwise the
  selection is not offered and the reader is told *"These words cannot be
  marked here exactly. Select them in Reading to mark them."*
- The selection must stay on one page.
- The strip sits below the pages, never over them.

**Bookmarks and notes.** The toolbar bookmarks the page in view, or adds a note
there. The place is stored with the page, how far down the page, and the page's
first paragraph, so it shows in Reading too. A page without text gets a
page-only place.

This was checked in Chromium with the real PDF.js in the screenshot harness:
- a highlight across a line break is drawn on both lines;
- a selection maps back to the exact stored words.

### Formatted EPUB and DOCX Original

- **Placing.**
  - The page's text pieces are walked in drawing order (`drawnStrings`).
  - The document's stored paragraphs (from the structure's segment range) are
    placed on them by the same exact matching.
- **Drawing.**
  - Highlights and noted words are drawn as `<mark>` pieces inside the book's
    own formatting (inside `<strong>`, links, Scripture references).
  - The book's text is unchanged. Nothing is drawn where the words are not
    found exactly.
- **Going to a mark.** Choosing a mark in the Marks list goes to its document
  and brings it into view.
- **Not yet.** Making marks directly in the formatted view needs selections
  inside a shadow root (`ShadowRoot.getSelection` in Chromium/WebView2,
  `getComposedRanges` elsewhere). It is left for v0.14.x, after it can be
  checked on Windows. Marks are made in Reading and appear here at once.

## Marks

**The Marks view (Scripture pane)** shows **Bible and sources**, **Bible only**
or **Sources only**.

- Under *Bible and sources*:
  - two sections are shown, "In the Bible" and "In your sources";
  - an empty section is left out;
  - when both are empty, one message says so.
- **Filters:**
  - the kind and the note search apply to both;
  - the book filter appears for the Bible, the source filter for sources;
  - the colour filter appears for highlights.
- **Source marks** are listed by source title, then reading order, with
  unresolved ones last.
- **Opening a mark:**
  - a source mark opens its source at its paragraph;
  - a mark on a PDF page opens that page in the Original.

The backend calls are `source_marks_list` (paged, offset) and
`source_marks_sources`.

**Inside a reader**, **Marks** sits beside **Contents** (one switch between
them). It lists the source's marks in reading order.

- Choosing a mark is a jump, so Back returns. In Reading it shows the
  paragraph's marks.
- An unresolved mark is listed with its words and the notice *"This place can
  no longer be found in the text."* It can be deleted.

**Removing a source** soft-deletes its marks. The confirmation says how many
go with it.

## Accessibility

- **Real buttons, and Escape.**
  - Every action is a real button. The strip, the marks panel and the Marks
    list close with Escape.
  - Focus returns to the marker, the toolbar button or the panel's button.
- **Colour is never the only sign.**
  - A paragraph marker and a PDF page marker say what is there (*"2 marks
    here: Highlight · Note"*).
  - Swatches are named, and noted words are underlined.
- **Without a mouse.**
  - Text selection with the keyboard works as in any document.
  - "Add note here" and "Highlight this paragraph" need no selection, and
    bookmarks need none.
- **Narrow panes.** The strip is in flow, the panels use the contents
  drawer/sheet layout, and toolbars wrap.

## Interface languages

Every new string is in English, German, Korean, French, Spanish and Portuguese:
- `library.marks.*`;
- `library.remove.marks`;
- `scripture.marks.scope.*`, `scripture.marks.section*` and
  `scripture.marks.empty.*Sources`;
- `errors.sourceAnnotations.*`.

Korean keeps the accepted terms: 자료 (source), 메모 (note), 강조
(highlight), 책갈피 (bookmark), 표시 (marks). The interface never says
anchor, segment or offset.

## Migration and data safety

- **0006 adds a table and four indexes.** It rewrites no existing row. Its
  only data step copies (never moves) any row that used the old
  `annotations.source_segment_id`.
- **Upgrade path.** The standard path runs: integrity check, backup before
  migrating, one transaction (`tests/migration_v6.rs`: a v5 database is backed
  up, upgraded, keeps its Scripture annotations, and opens again without a new
  backup).
- **Nothing is lost silently.**
  - A deleted mark is soft-deleted.
  - A removed source's marks are soft-deleted with it, their words kept in the
    file.
  - A segment that disappears sets the anchor's segment to NULL. The mark
    itself stays.

## Performance

**Listing a source's marks:**

- The source's marks are listed with one indexed query.
- Each mark is checked against its own segments.
- The whole text is read once, and only when a mark needs finding again.

**Drawing:**

- PDF placement runs once per drawn page. Zoom only recomputes boxes.
- Formatted placement runs once per document page, and its paragraphs are
  cached.

**The Marks list** pages 30 at a time, like the Bible's.

## Tests

**Rust** (`tests/source_annotations.rs`, 18; `tests/migration_v6.rs`;
`library::annotations` unit tests; `tests/text_refresh.rs` extended):

- **Anchoring:** context; a quote across paragraphs joined with `"\n"`; UTF-16
  offsets for Korean and characters outside the BMP (a split surrogate is
  refused); what each kind may hold; trimming.
- **Notes and bookmarks:** place notes; one bookmark per place; editing;
  recolouring in place.
- **Highlighter rules:** merge, split, cover, touch, recolour, other
  paragraphs and notes untouched.
- **Following text changes:** moved words, a lost paragraph found again by
  context, ambiguous and missing quotes left unresolved, context deciding
  between repeats, a highlight found again laid down without overlapping
  another colour.
- **Places and rebuilds:** a place's section fallback; passage-index rebuilds
  leaving marks untouched.
- **Removal and PDF pages:** removal; a scanned PDF page bookmarked.
- **Marks query and repair:** order, filters, paging, the sources list. The EPUB
  text repair moves a highlight to the same words in the repaired text.

**Interface:**

- `source-annotations.test.tsx` (14): selection strip, highlight, note,
  cross-paragraph quote, marks panel, Escape and focus, recolour, bookmark
  toggle, keyboard note and paragraph highlight, the reader's Marks list,
  unresolved marks, Marks view scopes, the removal message, focus returned
  after marking from the keyboard and after a paragraph's last mark goes.
- `source-selection.test.ts` (6): Korean, surrogates, skipped buttons and menus,
  joined paragraphs, trimming, untrusted text.
- `pdf-text-match.test.ts` (7): folding, hyphenation, ligatures, headers,
  repeats, paragraphs drawn out of reading order (never read as more than
  was selected), Korean, the text-layer offsets.
- `pdf-annotations.test.tsx` (5): page selection to a stored anchor, header
  refused, a Reading mark on its page at any zoom, page bookmarks (with and
  without text), a keyboard note.
- `formatted-annotations.test.tsx` (4): EPUB across formatting, nothing where
  the text differs, going to a mark, DOCX.
- `marks.test.tsx`: updated for the scope choice.

**Screenshot harness:** `source-selection`, `source-marks`, `marks`,
`pdf-marks` and `pdf-selection` exercise the real PDF.js in Chromium.

## Known limitations

- **Formatted Original:** marks are drawn there but made in Reading (v0.14.x).
- **One page at a time:** a selection on the Original PDF is read one page at a
  time. Across pages, select in Reading.
- **Unusual PDFs:**
  - a paragraph whose PDF.js text differs from the import beyond the folding
    rules (reading order on complex layouts, unusual encodings) is not
    placed;
  - its marks are listed by the page marker but not drawn;
  - the same holds for scanned pages (no text).
- **Context is short:** context is 32 characters on each side. After an
  extensive rewrite of a paragraph a mark may stay unresolved; it is never
  moved.
- **No bookmark toggle in the formatted Original:** the bookmark toggle and
  "Add note here" are in Reading and the Original PDF.

## Later

- **Ink** (stylus, pen) gets its own storage for strokes. The small `anchor`
  JSON stays positioning only (page, share of the page). A future kind can
  point at that storage without a table rebuild.
- **Studies.** "Add note to Study", "Create finding from annotation" and "Copy
  quotation with citation" can build on `quote`, `locator` and the anchor.
  Highlights never become findings automatically.
- **Re-import.** Restoring marks on re-import can use `sources.content_hash`
  and the quote-based recovery.
