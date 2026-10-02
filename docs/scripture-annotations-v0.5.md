# Abiding Word — Scripture Reading & Annotation v0.5

> Status: **in progress** (Phases 1–2 done, selection spike verified on
> ChromeOS/WebKitGTK; selection toolbar, colours, phrase and verse marks
> implemented — overlapping highlights still awaiting a decision). This document records the approved
> architecture and scope before the reader UI is built; sections marked
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
- Phrase highlight with an identical anchor → the existing one, recoloured.
- Bookmark on the same passage → the existing one.
- Notes are never merged; a verse may have several.

Overlapping highlights of different extents: see "Overlapping highlights"
(planned).

## Commands

| Command | v0.5 change |
|---|---|
| `annotation_list(reference, translationId?)` | returns `color` and `anchor` (with `shown` for the given translation) |
| `annotation_create(input)` | + `color`, `anchor {translationId, start, end, quote}` |
| `annotation_update(input)` | `content` and/or `color` (both optional) |
| `annotation_delete(id)` | unchanged (soft delete) |
| `annotation_anchor_check(input)` | new: validates a phrase anchor without saving; returns the rebuilt quote and covered verses (used by the selection spike, kept for the toolbar) |

## Reader interaction (planned)

- **Selection toolbar** — appears next to a text selection or after
  activating a verse number: five colour swatches, Note, and Bookmark only
  when the target is whole verses. Disappears after use.
- **One marker per annotated verse**, inline after the verse text; a
  button whose accessible label summarises the marks ("Verse 7: 2 notes,
  bookmarked, highlighted amber").
- **Annotation popover** — notes (with quote), highlights (colour, quote,
  "not shown in this wording"), bookmark; edit, recolour, delete.
- **Narrow pane** — the popover and note editor become a sheet inside the
  Scripture pane, chosen by the pane's width, not the window's.
- The inline `VerseTools` panel (which pushed the text down) is retired
  once the above fully replaces it. The commands stay.

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

The Phase 2 spike shows this live (see "Phase 2 spike").

## Selection toolbar, colours and rendering (implemented)

- `SelectionToolbar` (reader foot, sticky, in normal flow — not a floating
  overlay, so WebKitGTK positioning cannot break it) appears for a valid
  mapped selection with **Add note** and **Highlight**; never Bookmark.
  The anchor is captured when the selection settles and kept while a colour
  is chosen or a note written. Saving uses `annotation_create` with the
  anchor, clears the native selection and reloads the chapter.
- Whole-verse tools (`VerseTools`): Add note, Highlight (same five colours,
  recolour or remove), Bookmark; unchanged otherwise. Phrase highlights are
  listed there with their colour, quote and "Not shown in this wording".
- Drawing (`src/lib/annotationRender.ts`): a phrase highlight is a coloured
  `<mark>` and a phrase note a dotted underline, only where the core reports
  `shown`; they wrap parts of the verse text and never change it. A
  whole-verse highlight tints the verse block. One small marker per verse
  that has notes or a bookmark.
- Colours are tokens (`--aw-hl-*`, light and dark), named in all languages;
  no colour carries a meaning.

## Overlapping highlights (UNRESOLVED; not implemented)

Proposal (not approved; the owner rejected a simple "latest wins"): a character range shows one highlight colour only; no stacked layers. When
a new highlight overlaps existing ones in the same wording, the existing
ones are resolved deterministically (trimmed, split or replaced) so the
result looks like using a physical highlighter. If splitting proves
disproportionately complicated, simpler alternatives are reported before
that part is built. Until a rule is chosen the reader paints nothing where
different colours meet (`highlightPaint`, the single place to change); all
annotations remain stored and listed.

## Marks view (planned, Phase 6)

Inside the Scripture pane: Notes, Highlights, Bookmarks; filters by kind,
book and colour; simple search of note text; selecting an entry navigates
to the passage. A separate, paged query over the existing table — the
reader keeps loading one chapter's annotations only. No full-text index
unless measured performance requires one (that would be migration 0005).

## Accessibility (planned)

Verse-level keyboard parity for everything: semantic verse-number buttons
with larger hit targets, a semantic marker button, visible focus, Escape
closes the popover or sheet and returns focus, no hover-only functions,
colour never the only signal (labels name the colour and state), usable
touch targets in the toolbar. Phrase selection stays pointer/touch based;
no custom keyboard word-selection system in v0.5.

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
| 2 | selection → offsets spike in the real reader; **checkpoint** | spike ready, awaiting ChromeOS verification |
| 3 | verse-level palette, marker, popover, retire VerseTools | — |
| 4 | selection toolbar, phrase highlight and note, translation switching, overlaps | — |
| 5 | narrow-pane sheet, accessibility and focus | — |
| 6 | Marks view, filters, note search, navigation | — |
| 7 | documentation, tests, real-app acceptance, release preparation | — |

## Phase 2 spike

Off by default. Start the app with `VITE_SELECTION_SPIKE=1` (e.g.
`VITE_SELECTION_SPIKE=1 npm run tauri dev`) and a small "Selection check"
panel appears under the chapter. Selecting text shows the covered verses,
the UTF-16 offsets, the rebuilt quote, and the core's verdict
(`annotation_anchor_check` rebuilding the quote from the stored text).
Nothing is saved. The panel is removed when Phase 4 replaces it.

## Known limitations (so far)

- Phrase anchors are strict: any change to a verse's stored wording
  (including whitespace or punctuation) hides the phrase decoration; the
  annotation is kept.
- Offsets are checked against character boundaries, not grapheme
  clusters; a selection can in principle split a base letter from a
  following combining mark.
