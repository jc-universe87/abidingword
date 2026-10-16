# From Sources to Study (v0.15)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Using a book in your study](guide/05-library.md#using-a-book-in-your-study)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

Status: built on the branch `claude/beautiful-curie-vm0eve` from `main`
`591c1fc` (test build `0.5.0-dev.30`). Not merged, not tagged, no Windows build.
**Database migration 0007** (additive; backed up before it runs).
Deterministic only: no AI.

## Scope

A person reading a commentary, sermon manuscript, PDF, EPUB or Word document
can take something useful from it into the Study they are working on without
losing where it came from:

read → select, highlight or write a note → **Add to Study** → keep studying.

**Three workflows:**

1. **Add to Study** from selected words or from a highlight or note.
   - Selected words work in Reading and on an Original PDF page, with no mark
     made first.
   - Marks offer it in a paragraph's marks, a PDF page's marks, the reader's
     Marks list and the Marks view.
2. **A Study finding from a source mark.** It is always explicit; a highlight
   never becomes a finding by itself.
3. **Copy quotation with citation.** One plain format, usable outside the app.

**Two kinds of note, kept apart.** A *source note* is what the person wrote
while reading; it belongs to the source (v0.14). A *Study finding* is what they
deliberately brought into a Study. A source note can exist without any Study,
and a finding can cite one or more sources. The two are never merged.

## Model: `finding_sources` extended, no new table

`finding_sources` (0003, with title and author snapshots from 0004) is the
citation model. Migration 0007 adds four nullable columns:

| Column | Why |
|---|---|
| `quote` | What the source said: the selected stored text, with paragraphs joined by `"\n"` (the v0.14 convention). It is kept apart from what the person wrote, and kept when the source is removed. |
| `cited_section` | The section path at the time ("Chapter 3 › Grace"). It gives a readable location when there is no page, and is kept on removal. |
| `anchor` | A small versioned JSON object, `CitationAnchor` (v1). For words it holds both ends (segment and UTF-16 offset), 32 characters of context, the reading position and the page. For a place it holds a paragraph, or a page of an Original PDF and how far down. This uses the same anchoring as a source annotation and never a view's coordinates. |
| `annotation_id` | The source mark it was made from, if any. This is a **weak link**: there is no foreign key, so deleting the mark never touches the finding or its citation. |

**Unchanged:**
- Existing rows keep working with these columns empty: the migration test reads
  them back exactly as before.
- The pre-migration backup and integrity check run as always.
- No row is rewritten.

**What the citation snapshots.**
- *Title and author*: as before, the live source's are shown while it exists,
  and the snapshot afterwards.
- *Location*: the paragraph's locator ("p. 42", a section, or "¶ 4").
- *The section path and the quote.*

### Making a finding from a source

`finding_create_from_source` creates the finding and its citation in **one
transaction**. Its input is the Study, the kind, the person's text and the part,
plus one of three things:

- **Selected words.** Both ends and the quote. They are checked against the
  stored text by the same function that anchors a highlight; a mismatch is
  refused (`sourceAnnotations.textChanged`) and nothing is created.
- **A place.** A paragraph, or a PDF page with how far down.
- **A mark** (`annotationId`).
  - Its words are copied, checked again where they are now.
  - If the mark is unresolved, its words are kept without a place.
  - A note on a place gives its place.
  - A bookmark is refused (`sourceAnnotations.bookmarkNotStudy`).

**The finding's text** is what the person wrote. When they wrote nothing, the
quote becomes the text, so a pure Quotation reads and searches as before. The
citation keeps the quote either way. A place with nothing written is refused
(`findings.writeFirst`).

**Nothing else changes.** No passages are added for Scripture references in the
quote, and the mark is not modified.

### Exact duplicates

`already_cites` suppresses only a citation with the same source, the same place
in it (both ends and offsets, or the same page and position) and the same quote.

- The same words elsewhere in the paragraph or source are **another citation**
  (regression-tested with "upon grace" twice in one paragraph).
- Words that can no longer be placed count as one citation only if they come
  from the same mark.
- A whole paragraph cited the v0.4 way ("+ Add source") is still one per
  paragraph.

Two *findings* from the same words are the person's choice, and both are kept.
`finding_source_add` also accepts selected words, a place or a mark for an
existing finding, using the same rules.

### Reopening a citation

`finding_source_locate` gives where a citation is now. It returns `null` once
the source is removed. It runs the **v0.14 resolver** over the citation's own
anchor:

1. The words at their stored offsets.
2. Else the words found again unambiguously in the same paragraphs, nearby with
   context, on the same page or section, or in the whole source.
3. Else, if the result is ambiguous or the words are not found, no words are
   given; the source opens at the paragraph the words began in, if it is still
   there.
4. Else its page or section.
5. Else the start of the source.

A place on a PDF page opens that page. Words are only given when they were found
exactly, so a guessed occurrence is never marked.

## Interface

### Which Study (application state)

`StudyFocusProvider` (in App, around Shell) holds:
- the open Study's id;
- the part last worked in this session;
- a "findings changed" signal.

How it is kept current:
- The Study pane publishes the open Study, and none while browsing.
- The Study editor publishes the part last focused, and reloads its findings
  when a finding is added to it from a source.
- Before the Study pane has spoken, the provider starts from the Study pane's
  remembered place.

So the flow works in the full-screen reader too, and with the Study pane hidden.
Nothing new is saved: the part last worked in lasts for the session. The source
reader never reaches into the Study pane's components.

### Add to Study panel

A compact panel in the reader's selection slot: Reading at the foot of the text,
the Original PDF below the pages, never over them. It is not a modal. It shows:

- **"Add to Study: {Study}"**, with **"Another study…"** to choose another.
- **The source's words** (read-only) with "— Author, Title, place".
- **"Your note (optional)"**: the person's text, prefilled from a source note.
- **The kind.** Quotation, Observation, Interpretation, Application and Question
  are shown, with *More types* for the rest.
  - The default is **Quotation** until the person writes something, then
    **Observation**, until they pick a kind.
  - The kind remembered by Quick Capture is not reused.
- **In:** the part last worked in, else *Whole study*.

**Defaults and empty states:**
- With no Study open, the panel offers the existing studies, most recent first.
- With none at all, it says so plainly and offers only Cancel.
- Nothing is added until **Add to Study** or **Ctrl+Enter**; **Escape** or
  **Cancel** adds nothing.

**After adding:**
- A polite status line says "Added to {Study} · {part}."
- Focus returns to the button that opened the panel, else to the paragraph the
  words were in.

### Where the action appears

| Place | Add to Study | Copy quotation with citation |
|---|---|---|
| Selected-words strip (Reading, Original PDF) | button | in *More actions* |
| A paragraph's marks / a PDF page's marks | button (highlights and notes) | in *More actions* (marks with words) |
| Reader's Marks list | in each row's *More actions* | same menu |
| Marks view (source cards) | in *More actions* (with *Open source*) | same menu |

**Bookmarks are never offered:** they hold no Study content. Bible marks are
unchanged. *More actions* is one small, real menu (`ActionMenu`):
- arrow keys move through it;
- Escape returns to its button;
- Tab leaves it.

### Copy quotation with citation

There is one formatter, `quotationWithCitation`, in
`features/library/labels.ts`. Every place that copies uses it:

```
“Selected quotation …”
— Author, Title, p. 42
```

- **Order and wording.** The citation is `citationText`, the same line shown on
  Study citations. Its parts are the author, the title, and the place.
- **Leaving things out.** A missing author is left out ("— Title, p. 42").
- **Place.** The place is the page (translated: *p.*, *S.*), else the section
  path.
  - A paragraph number ("¶ 4") is an Abiding Word count no printed copy has. It
    is never copied or shown; the section is used instead, or nothing.
- **Quotation marks** follow the interface language (`library.copy.quoted`):
  “…” in English, Korean and Portuguese, „…“ in German, « … » in French and «…»
  in Spanish.
- **Never invented.** Publisher, year and edition are not used, and a source's
  own `citation` field has no editing screen yet, so it is not used either.

The text goes to the web view's own clipboard. If that is missing, the older
copy command is used. No Tauri plugin was needed. A status line confirms
"Quotation copied with its citation." or says it could not be copied.

### In the Study

A source-backed finding shows, in this order:

1. The person's text (primary).
2. The source's words, quietly. These are hidden when the finding's own text is
   just those words.
3. The citation as a real button, "📖 Author, Title, place".

Clicking the citation opens the source in the Sources pane, beside the Study.
The cited words are marked when they were found exactly; otherwise the reader
opens at their paragraph, page or section.

If the source has been removed:
- the citation reads "(removed from library)" and cannot be opened;
- the quote and the citation remain;
- *Copy quotation with citation* still works from what was kept.

## Accessibility

- **Keyboard.** Every action is a real button or menu item, and the whole flow
  works from the keyboard. A mark's marker leads to Add to Study, then the
  note, the kind (with arrow keys), the part (a native select) and Ctrl+Enter.
- **Focus.**
  - The panel opens with focus in "Your note".
  - Escape closes the innermost layer only.
  - Save and Cancel return focus where the action was asked for.
- **Announcements.** Confirmations are polite live regions. The reader's region
  is always present, so the confirmation is read out when it appears.
- **Target size.** Controls in the Study pane keep 44 px targets (the existing
  test still holds).

## Interface languages

There are 22 new strings, translated into all six languages:
- `library.toStudy`, `library.copy`, `library.more`;
- `library.citations.open`, `quoteLabel` and `openFailed`;
- `studies.fromSource.*`;
- errors `findings.writeFirst` and `sourceAnnotations.bookmarkNotStudy`.

Korean uses the accepted terms: 성경공부에 추가, 내 기록, 출처와 함께 인용 복사,
자료 열기, 부분. It does not use 연구, 프로젝트, 섹션 or 블록. French calls the
person's text *commentaire*, since *note* there is a source note.

## Tests

**Rust: `tests/sources_to_study.rs` (9 tests)**
- Selected words become a finding, with the quote kept apart and not rewritten
  by editing.
- The chosen part.
- Refusals: wrong words, an unknown kind, another study's part, a place with
  nothing written. No partial rows are left behind.
- Korean, a character outside the BMP, and a quote across paragraphs.
- The same words twice are two citations; the same place is one; whole
  paragraphs are one per paragraph.
- Highlights, notes on words and notes on places; bookmarks are refused; the
  mark is unchanged; deleting it leaves the finding unchanged.
- Removing the source keeps every snapshot, and the citation cannot be opened.
- Moved words are followed; ambiguous words are not guessed.
- PDF words and PDF page places; a page place reopens on its page, how far
  down, even when it also names its paragraph.
- Study duplication copies quotes, places and snapshots.

**Rust: `tests/migration_v7.rs`**
- Backup.
- Old citations read as before.
- A removed source.
- Reopening again makes no new backup.

**Interface: `tests/ui/sources-to-study.test.tsx` (18 tests)**
- Selection to Study:
  - the defaults;
  - no mark is made;
  - the Study shows the finding;
  - the confirmation and the focus.
- The part last worked in, choosing another part, the kind with arrow keys, and
  Ctrl+Enter.
- Cancel and Escape add nothing.
- From the selection strip by keyboard, focus stays in the note; Escape closes
  only the panel.
- The study picker; no studies at all.
- Highlight, note on words, place note from the Marks list, no bookmark, and
  keyboard-only use.
- Copying in English and German, with no author.
- The Study display, opening at the marked words, and quotation shown once.
- A removed source (display and copy).
- A note being written is not disturbed.
- The Marks view menu, with Bible marks unchanged.

**Interface: `tests/ui/pdf-annotations.test.tsx` (+1)**
- Words selected on a PDF page, across a broken word, are added to a Study with
  their page, and no mark is made.

## Known limitations

- **Formatted EPUB/DOCX Original.** Selecting text there is still not offered,
  as in v0.14. Marks shown there can be added from the reader's Marks list.
- **Opening on a PDF.** In the Original PDF the source opens at the page of the
  cited paragraph, but the words are marked only in Reading.
- **One citation per finding from the panel.** Adding further sources to an
  existing finding is through *+ Add source*, or the core's `finding_source_add`.
- **Changing the Study.** The panel's study choice lists studies by most recent
  change, with no search.

## Later

- *Show the original mark* from a finding, using `annotation_id`.
- Selection in the formatted Original once it is verified on WebView2.
- Recognised Scripture references in a quote offered explicitly (never
  automatically) as related passages.
- Citation styles and bibliography: not before there is a need.
