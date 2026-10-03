# Abiding Word — Scripture Reading & Annotation v0.5

> Status: **in progress.** Implemented: typed annotation data, phrase
> anchors, the selection toolbar, colours, phrase and verse marks, and the
> overlapping-highlight rule below. The selection spike was verified on
> ChromeOS/WebKitGTK. The Marks view is implemented. Sections marked
> *planned* describe work not yet implemented.

Builds on [`scripture-v0.2.md`](scripture-v0.2.md) (canonical references,
translations, the `annotations` table). The frozen
[`architecture.md`](architecture.md) §20 ("Annotations should exist
independently of full Studies") and [`concept.md`](concept.md) remain the
authority.

## Purpose

**Mark while reading → find it again.** Make the Scripture reader good for
careful reading: highlight a verse or a phrase in one of a few restrained
colours, leave a quick note on a verse or a phrase, see a small marker
where marks exist, bookmark places, and find any of these again later.

Out of scope: Study integration, AI, formatted Bible rendering, export,
sync, general notes management.

## Principles

- **Annotation ≠ Finding.** An annotation is a lightweight personal mark
  made while reading Scripture. A finding is a structured observation,
  conclusion or question that belongs to a Study. They stay separate
  entities. A later milestone may *copy* an annotation into a finding
  (see "Future integration point"); it never turns one into the other.
- **Canonical first.** Every annotation is attached to a canonical passage
  (verse-key range), so it survives translation switches and removals.
- **Wording-specific phrase anchors.** A phrase mark also records the exact
  wording it was made on. It is *drawn* only where that wording is verified
  to be identical. Never fuzzy matching, never AI matching, never guessing.
- **User-driven and deterministic.** Highlight colours are colour names
  only; no colour, kind or bookmark carries a theological or study meaning.
- **No migration in v0.5** unless implementation proves a genuine need.
  Migrations 0001–0004 are frozen.

## Kinds and translation dependence

| Kind | Target | Translation dependence |
|---|---|---|
| Bookmark | verse(s) | independent |
| Verse highlight | verse(s) | independent; colour |
| Verse note | verse(s) | independent |
| Phrase highlight | words within one chapter | canonical range is independent; the coloured phrase is drawn only in identical wording |
| Phrase note | words within one chapter | marker and note are visible in every translation; the phrase underline only in identical wording |

Bookmarks are navigational only and never carry a phrase anchor.

## Data model (no migration)

The `annotations` table from migration 0002 already holds everything
needed: canonical `passage`, `start_key`/`end_key`, optional
`translation_id` (`ON DELETE SET NULL`), `kind`, `content`, soft delete,
`revision` — and a `data` JSON column that v0.2 never used. v0.5 gives
`data` a typed, versioned shape. Rust (`scripture/annotation_data.rs`)
builds and validates it; JSON from the interface is never stored as given.

```json
{
  "v": 1,
  "color": "amber",
  "anchor": {
    "start": { "verse": 43015004, "offset": 12 },
    "end":   { "verse": 43015005, "offset": 9 },
    "quote": "about remaining. Fixture alpha",
    "verses": [
      { "verse": 43015004, "sha256": "…" },
      { "verse": 43015005, "sha256": "…" }
    ],
    "translationShortName": "WEB"
  }
}
```

- `color` — highlights only: `amber`, `green`, `blue`, `rose`, `grey`.
  A highlight with no stored colour (every v0.2 highlight, `data` NULL) is
  `amber`, the default. Notes and bookmarks never store a colour.
- `anchor` — phrase highlights and phrase notes only.
  - `start`/`end`: verse key and offset into that verse's stored text, in
    **UTF-16 code units** (JavaScript string indexes, as the reference
    detector already uses), end exclusive. Start and end are in the same
    book and chapter; a selection never spans chapters.
  - `quote`: the selected words, rebuilt by the core from the stored text:
    the selected part of each covered verse, joined with one space.
  - `verses`: every covered verse that the translation has, with the
    SHA-256 (lower-case hex) of its complete stored text.
  - `translationShortName`: provenance snapshot, so the label survives the
    translation's removal (`translation_id` then becomes NULL), like the
    citation snapshots of v0.4.
- `translation_id` (column) is set to the translation the phrase was
  marked in, for provenance only. It is **not** the anchor's identity:
  every install of a Bible gets a new id, even the same file again.

Annotations whose `data` is NULL or empty remain valid.

### Validation (core)

Creating a phrase mark sends the translation, start verse + offset, end
verse + offset and the quote the interface saw. The core:

1. checks start and end verses are real, in one chapter, in order;
2. reads that translation's stored text for every verse in the range;
3. checks both offsets fall inside their verse and on a character boundary
   (never inside a surrogate pair) and the range is not empty;
4. rebuilds the quote from the stored text and requires it to equal the
   quote sent — any mismatch is refused, nothing is guessed;
5. hashes each covered verse and stores the anchor; the annotation's
   canonical passage is the covered verse range.

### Rendering rule

`annotation_list(reference, translationId)` reports, for each phrase anchor,
`shown`: true only if the given translation has **exactly the same set of
covered verses with identical hashes**. Consequences:

- same translation → drawn;
- another translation with different wording → not drawn; the annotation
  is kept and listed with "not shown in this wording";
- the same Bible removed and added again (new id, same text) → drawn again;
- a revised edition whose wording changed → kept, not drawn.

### Duplicates

- Verse highlight on exactly the same passage → the existing one is
  returned, recoloured to the requested colour (like going over a line
  again with another highlighter).
- Phrase highlight on exactly the same words → the existing one, recoloured
  (see "Overlapping highlights").
- Bookmark on the same passage → the existing one.
- Notes are never merged; a verse may have several.

Phrase highlights that overlap or touch: see "Overlapping highlights".

## Commands

| Command | v0.5 change |
|---|---|
| `annotation_list(reference, translationId?)` | returns `color` and `anchor` (with `shown` for the given translation) |
| `annotation_create(input)` | + `color`, `anchor {translationId, start, end, quote}` |
| `annotation_update(input)` | `content` and/or `color` (both optional) |
| `annotation_delete(id)` | unchanged (soft delete) |
| `annotation_anchor_check(input)` | new: validates a phrase anchor without saving; returns the rebuilt quote and covered verses (used by the selection spike, kept for the toolbar) |

## Reader interaction (implemented)

- **Selection toolbar** — a stable bar at the foot of the reader for a text
  selection: Add note and Highlight (never Bookmark). See "Selection toolbar,
  colours and rendering".
- **Verse number** — a button (larger hit area, `aria-expanded`) that opens
  the annotation inspector for that verse; activating it again closes it. It
  also selects the verse, as before ("Link current passage").
- **One marker per annotated verse** — a single button after the verse text,
  shown when anything covers the verse (notes, bookmark, a verse highlight,
  a phrase highlight). Its name says what is there, with counts and the
  colour name, never by icon or colour alone ("Verse 7: 2 notes, bookmarked,
  highlighted Amber. Show annotations"); its icon is a note, a bookmark or a
  highlighter when there is one kind of mark and a stack when there are
  several. It opens the same inspector and has `aria-expanded`.
- **Annotation inspector** (`AnnotationInspector.tsx`) — the one place for a
  verse's marks, replacing the old inline `VerseTools` block that pushed the
  text down (nothing is inserted under a verse any more). Whole-verse: Add
  note, Highlight (the five colours, recolour, remove), Bookmark (pressed
  state). Existing marks: notes with edit and delete (a phrase note shows its
  words), phrase highlights with colour name, words, recolour and remove, each
  with "Not shown in this wording" when the translation on screen does not
  have that exact wording. A phrase mark or note that spans several verses is
  listed in the inspector of every verse it covers. No hashes or offsets are
  shown. Recolouring a phrase highlight uses `annotation_update`, so the
  core's overlap rules apply; the interface has no overlap logic.
- **Layout from the Scripture pane's own width** — a compact panel when the
  reader is at least 480 px wide, a full-width **sheet** (stacked controls,
  scrolls inside itself, text fields fill the width) when it is narrower,
  measured with a `ResizeObserver` on the reader, not the window. Both sit
  at the foot of the reader like the selection toolbar, in normal flow with
  `position: sticky`: no floating overlay and no position arithmetic, which
  were unreliable in WebKitGTK. If the panel would cover the verse being
  worked on, the reader scrolls just enough to bring that verse clear above it.
- **Focus and Escape** — opening focuses the inspector's heading. Escape
  closes the innermost thing first (the colours, a note being written or
  edited), then the inspector, and focus returns to the verse number or
  marker that opened it (the verse number if that marker has gone). The
  note editor takes focus when it opens; cancelling returns focus to Add note
  or Edit; deleting something keeps focus inside the inspector. Escape does
  not reach the rest of the app. Close is also a button.
- **One inspector at a time.** Opening another verse replaces it; changing
  chapter or translation closes it, for good. Switching translation never
  changes an annotation.
- **Errors** (translated, coded) keep the inspector open and keep a note being
  typed.
- Phrase *selection* stays pointer/touch; there is no keyboard word selection.

## Selection anchoring in the reader

Each verse's text is rendered inside its own container
(`data-verse-text`), separate from the verse-number button and markers,
which are `user-select: none`. A DOM selection is turned into an anchor
by `src/lib/selectionAnchor.ts`:

- every verse-text container the selection touches contributes the
  selected part; the offset inside a container is the length of the text
  from the container's start to the selection boundary (a DOM `Range`,
  so it is UTF-16 and works however the text is split into spans);
- a boundary outside any verse text (on a verse number, a marker, between
  verses) snaps to the nearest verse-text edge;
- surrounding whitespace is trimmed, and a boundary never splits a
  surrogate pair;
- verses touched only at an edge (nothing selected in them) are dropped.

The Phase 2 spike shows this live (see "Phase 2 spike"); the toolbar uses the same mapping.

## Selection toolbar, colours and rendering (implemented)

- `SelectionToolbar` (reader foot, sticky, in normal flow — not a floating
  overlay, so WebKitGTK positioning cannot break it) appears for a valid
  mapped selection with **Add note** and **Highlight**; never Bookmark.
  The anchor is captured when the selection settles and kept while a colour
  is chosen or a note written. Saving uses `annotation_create` with the
  anchor, clears the native selection and reloads the chapter.
- Whole-verse tools and the list of a verse's marks live in the annotation
  inspector (see "Reader interaction").
- Drawing (`src/lib/annotationRender.ts`): a phrase highlight is a coloured
  `<mark>` and a phrase note a dotted underline, only where the core reports
  `shown`; they wrap parts of the verse text and never change it. A
  whole-verse highlight tints the verse block. One marker button per annotated verse.
- Colours are tokens (`--aw-hl-*`, light and dark), named in all languages;
  no colour carries a meaning.

## Overlapping highlights (implemented)

Phrase highlights behave like a physical highlighter. **A new highlight owns
exactly the words it covers**; highlights already on the same wording are
made to fit around it. A stretch of text therefore shows one colour, with no
stacked layers and no blended colours. This is decided in the core
(`db/annotations.rs::highlight_phrase`, range arithmetic in
`scripture/phrase_ranges.rs`) so every front end gets it; the reader only
draws the result. There is no migration.

**Same wording only.** An existing phrase highlight takes part only if it is
*shown* in the translation the new one is made in, i.e. its stored verse
hashes equal that translation's text. Identity is the hashes: not the
translation name, not `translation_id` (provenance only), and not canonical
overlap alone. WEB's "God saw everything" and a German "Und Gott sah alles"
share a verse but are independent; two installs of identical text are one
wording.

**Positions.** A range is `(verse key, UTF-16 offset)` to `(verse key,
offset)`, end exclusive. To compare ranges (including across verses) the
chapter's stored verses are laid end to end and a position becomes a count
of UTF-16 units, so the end of a verse and the start of the next are the
same point, and highlights that meet there touch.

**Rules.** In order, inside one transaction (all or nothing):

1. *Same colour, overlapping or touching* → merged into one continuous
   highlight. The new range grows over every such highlight, repeatedly
   (a chain of them merges). The earliest of them is kept and extended (its
   translation provenance becomes the wording it was extended in); the
   others are soft-deleted.
2. *Different colour* → cut against the final range:
   - wholly covered → soft-deleted;
   - overlapped at its start or end → trimmed (revision + 1);
   - the new range lies inside it → **split**: the original keeps the part
     before, a new highlight (same colour and provenance, original creation
     time) takes the part after.
   A remainder that holds only whitespace is dropped.
3. *Exactly the same words*: same colour → nothing changes; another colour →
   the existing highlight is recoloured in place (same id).
4. If nothing was merged or recoloured, the new highlight is inserted.

Every surviving piece gets a completely rebuilt anchor from the stored Bible
text (`build_anchor`: validated offsets, rebuilt quote, hashes of the covered
verses), never an old quote with new offsets. Recolouring a phrase highlight
with `annotation_update` follows the same rules.

**Never affected:** phrase notes (they may sit over anything and are never
trimmed, split, merged or deleted); whole-verse highlights (a separate,
translation-independent layer; a phrase highlight can sit on top of the
tint); bookmarks. Soft-deleted rows are ignored.

**Older data.** Highlights saved before this rule may still overlap with
different colours. They stay readable and listed; the reader paints nothing
for a stretch where different colours still meet (it never picks a winner),
and the next highlight made over them is normalised by the core.

## Marks view (implemented, Phase 6)

"I marked something earlier — show me." Marks is the second view of the
**Scripture pane**, beside **Bible** (the default): one plain switch at the
top of the pane, not a new page. It lists notes, highlights and bookmarks
together as readable cards, in **Scripture order** (book, chapter, verse;
then oldest first), so it reads like the annotations in a Bible rather than
a notes app. There is no sort menu.

- **Filters** (all simple, nothing to configure first): *All | Notes |
  Highlights | Bookmarks*; a *Book* choice; and, **only while Highlights is
  chosen**, a *Colour* choice (colours named in words). Choosing another kind
  forgets the colour.
- **Search** is a single box over **note text** (case-insensitive in every
  script, not only ASCII). It is shown with *All* and *Notes* only, because
  highlights and bookmarks have no words; a search always means notes. There
  is no syntax.
- **Cards** show the passage in the interface language's book name (never a
  code), what it is (Note / Highlight / Bookmark), a note's words, a phrase's
  quote (a phrase note shows the quote above its words), a highlight's colour
  as text plus a swatch, "Whole verse" for a verse highlight, and **"Not shown
  in this wording"** when a phrase mark does not fit the translation being
  read. No ids, offsets, hashes, revisions or dates are shown.
- **Navigation.** Choosing a card switches to Bible, goes to that passage and
  brings the verse into view with the reader's own "showing …" marking. The
  translation is **never** switched to reveal a phrase; if the wording differs
  the verse is still shown and its mark stays reachable through the marker and
  the inspector. Marks is a way back, not a second editor: editing, recolouring
  and removing stay in the inspector, where the passage is.
- **Coming back.** The Bible stays mounted under Marks, so switching back
  restores the same passage, scroll position and open verse tools.
- **Paging.** 30 marks at a time with **Load more** (the query accepts up to
  100); the reader keeps loading one chapter's annotations only.
- **Empty states** are short and warm (no marks yet; nothing matches; no
  notes match the search).

Backend: `annotation_marks_list` (`db::annotations::marks`), a dedicated paged
query over the existing `annotations` table, live rows only, with optional
kind, book (a verse-key range of the book), colour (the stored colour, a
missing one being the default, tolerant of damaged data) and note text; phrase
marks are checked against the translation shown exactly as the reader's own
list does. Order is the verse key (book ordinal, chapter, verse) then
`end_key`, `created_at` and row id. The note search reads the ordered rows and
stops when the page is full, so it needs no index: measured on 10,000 notes,
the worst case (a word that matches nothing, scanning every note) took about
14 ms in a release build and the first page about 0.2 ms. **No migration and no
full-text index** (that would have been migration 0005). If a person's marks
ever grow far beyond that, FTS can be added later behind the same query.

Limitations: no sorting choices, no tag or translation filters, no saved
searches, no bulk actions; search covers note text only; a mark spanning more
than one book is listed under the book it starts in.

## Accessibility (implemented)

Everything on a verse is reachable from the keyboard: semantic verse-number
and marker buttons with comfortable hit areas and `aria-expanded`/
`aria-controls`, visible focus, no hover-only functions, an inspector that is
a labelled region with a heading that takes focus, Escape that closes the
innermost thing then the inspector and returns focus to the opener, textareas
with labels, errors as alerts, colour names as text (colour is never the only
signal) and 40 px-high controls. Phrase selection stays pointer/touch based;
there is no custom keyboard word-selection system in v0.5.

## Interface languages

All new annotation text (toolbar, popover, marker labels, colour names,
Marks view, messages, `aria-label`s) must be translatable into `en`, `de`,
`ko`, `fr`, `es`, `pt` (README, "Interface languages"). The i18n
foundation is in place (`docs/i18n.md`); every string added here exists in
all six languages, and the core's annotation errors carry stable codes
(`errors.annotations.*`).

## Original Bible documents (principle only)

Structured Scripture is the working representation. The original imported
Bible file is kept where applicable (`sources/bibles/<id>/` for a user's
files; the bundled WEB in the app's resources) and may later give access to
publisher formatting, paragraphs, poetry, headings and footnotes. Not
implemented in v0.5. Any future formatted view must never change the stored
verse text, because phrase anchors are verified against it.

## Future integration point: annotation → finding

Deferred to a Study-integration milestone. Intended shape: from a note's
popover, "Copy to finding…" into a Study; `finding_create` already accepts
content and a canonical passage. Provenance would be recorded on both sides
(`findings.data` and the annotation's `data`, both unused today). The
annotation stays where it is; the finding is a separate record.

## Phases

| Phase | Content | Status |
|---|---|---|
| 0 | branch, this document, baseline | done |
| 1 | typed annotation data, colours, anchors, validation and hashing, backward compatibility, Rust tests | done |
| 2 | selection → offsets spike in the real reader; **checkpoint** | done (verified on ChromeOS/WebKitGTK) |
| 3 | selection toolbar, five colours, phrase highlight and note, verse highlight with colour, one marker per verse | done |
| 4 | overlapping phrase highlights (physical-highlighter normalisation in the core) | done |
| 5 | annotation inspector (retires inline VerseTools), interactive marker, narrow-pane sheet, focus and accessibility | done |
| 6 | Marks view, filters, note search, navigation | done |
| 7 | documentation, tests, real-app acceptance, release preparation | — |

## Phase 2 spike

Off by default. Start the app with `VITE_SELECTION_SPIKE=1` (e.g.
`VITE_SELECTION_SPIKE=1 npm run tauri dev`) and a small "Selection check"
panel appears under the chapter. Selecting text shows the covered verses,
the UTF-16 offsets, the rebuilt quote, and the core's verdict
(`annotation_anchor_check` rebuilding the quote from the stored text).
Nothing is saved. The panel stays behind the flag for diagnostics; the real toolbar needs no flag.

## Known limitations (so far)

- Phrase anchors are strict: any change to a verse's stored wording
  (including whitespace or punctuation) hides the phrase decoration; the
  annotation is kept.
- Offsets are checked against character boundaries, not grapheme
  clusters; a selection can in principle split a base letter from a
  following combining mark.
