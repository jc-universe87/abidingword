# Passage-aware sources (v0.9)

**Status: first implementation checkpoint, on `feature/passage-aware-sources-v0.9`
(not merged).** Branched from the green `main` that already publishes the
Windows test channel automatically ([`updates.md`](updates.md)).

When someone reads a Scripture passage, the Sources pane surfaces the Library
material that is about it. Until v0.8 that meant paragraphs whose own text
contains a Bible reference. A commentary section headed "John 15:1–11 — The
True Vine" was invisible, because its paragraphs never repeat the reference and
the heading itself was not even scanned. v0.9 closes that gap and says, for
every place it shows, **why**.

> **Deterministic only.** No AI, no embeddings, no semantic or text similarity.
> Everything below is a rule that can be read, tested and reproduced.

## Kinds of link, and why a place is shown

| Kind (`source_passages.origin`) | Meaning | Shown as |
|---|---|---|
| `explicit` | The segment's own text contains the reference | "Mentions John 15:5" |
| `section` | The heading that opens a section names the passage; the link sits on the section's first segment (its opening place) | "Section on John 15:1–11" |
| `inherited` | A later segment of that section | "Within section on John 15:1–11" |
| `manual` | A person confirmed the link (a seam only: nothing writes it yet, and no tagging interface is built) | "Linked to John 15:1–11" |

The words in the right-hand column are the only vocabulary a user sees; "origin",
"inherited link" and the like never appear. All six interface languages have them
(`library.passage.*`, `library.pane.*`).

## Where structure comes from (and what was found)

None of the importers (EPUB, Word, Markdown) turns a heading into a segment.
A heading is kept only as structure on the paragraphs below it: the segment's
`section_path`, e.g. `Commentary on John › John 15:1–11 — The True Vine`.
So the derivation reads **stored structure, not text**, and is the same
function at import and when an existing library is re-indexed (below).

- **EPUB, Word (.docx), Markdown:** their headings give `section_path`, so they
  are first-class.
- **PDF:** the importer finds no reliable headings, so **nothing is derived and
  no structure is invented**. Explicit mentions only.
- **Plain text:** no structure. Explicit mentions only.
- Format is checked as well as the path (`library::sections::has_sections`), so a
  format without structure can never receive derived links.

## Exact inheritance rules

(`src-tauri/src/library/sections.rs`, with its tests.)

1. A **section** is a heading and everything below it: the run of consecutive
   segments whose path starts with the heading's path. It ends where the path
   leaves that prefix (a sibling or higher heading starts), or at a segment with
   no path (a footnote, say).
2. A heading names a passage **only through references written in its own text**.
   Every reference is kept separately (never merged into one broad range; the
   same canonical passage twice counts once; at most 8 per heading, the rest of a
   long list is left to the text). Body text never creates or changes a section's
   passage; a paragraph's own references stay its `explicit` links.
3. A segment inherits from the **nearest** heading at or above it that names a
   passage, and only from that one. A narrower section is not widened by the
   chapter heading above it; a sibling section's passage never leaks into the next;
   a section with no passage of its own, below one that has one, belongs to the
   ancestor's passage.
4. The section link goes on the section's first segment; every later segment gets
   an inherited link. Several headings can open on the same segment (each gets its
   own section link).
5. A book name alone ("Commentary on John") names no passage: a reference needs a
   chapter.

Example (invented):

```
## John 15:1–11 — The True Vine     paragraph A  → section   John 15:1–11
                                    paragraph B  → inherited John 15:1–11
                                    paragraph C  → inherited John 15:1–11
## John 15:12–17 — Love One Another paragraph D  → section   John 15:12–17
## Closing remarks                   paragraph E  → (nothing)
```

## Data model: the smallest migration

`migrations/0005_passage_sections.sql` adds columns, rewrites no row, and leaves
every existing meaning intact (existing rows are `explicit` by default):

- `source_passages.origin` — `explicit | section | inherited | manual`, checked.
- `source_passages.section_segment_id` — the first segment of the defining
  section (cascades with the segment), for `section` and `inherited` links.
- `source_passages.section_heading` — the defining heading's own text.
- `sources.passage_index_version` — which derivation built a source's links.
- Indexes on `(origin, start_key, end_key)` and `section_segment_id`.

Provenance is in columns, never packed into a text field. `matched_text` keeps
meaning "as written in the source" (for a section link: in the heading), and
`start_offset`/`end_offset` keep meaning "inside the segment" (NULL for derived
links, which are not in the segment's text). The Library's per-source passage
count and the literal-mention lookups (`library::mentions`, `library::passages`)
still count and return **explicit links only**, as in v0.4.

Links are **canonical Scripture references** (`JHN.15.1-JHN.15.11`) with verse-key
ranges, not anchors into any translation's text, so nothing here ties a source to
one displayed Bible.

## Existing libraries: a deterministic rebuild, nothing re-imported

Sources imported before v0.9 have `passage_index_version = 0`. When the database
opens (`Database::initialise`):

1. the existing migration machinery has **already made a verified backup** before
   applying 0005 (no backup, no migration);
2. `library::ensure_passage_index` rebuilds the derived links of every out-of-date
   source from its **stored** `section_path` values, one transaction per source:
   delete that source's derived links, insert the new ones, set the version;
3. it never touches explicit links, segments, citations or the managed files, so a
   re-run is harmless and gives the same result (a test compares import with
   rebuild);
4. a source that fails is logged and left as it was (its explicit links keep
   working) and retried at the next start.

Nothing needs deleting and re-importing. When the rule changes later, bump
`sections::INDEX_VERSION` and the same path rebuilds. Measured: 8 sources with
12,800 segments rebuild in about 0.6 s (debug build).

## The Sources pane

`library::passage_sources` returns **groups**, one per source:

```
A Synthetic Commentary                         ← one entry, not one card per paragraph
  P. Example · Commentary › John 15:1–11 — The True Vine
  Section on John 15:1–11
  ├ best place, then up to two more, then "3 more places in this source"
```

- **Candidates** are explicit, section and manual links in the chapter(s) of the
  passage. Inherited links are left out: each is represented by its section's
  opening place, and they are by far the most numerous.
- **Ranking** (`library/relevance.rs`, pure functions with tests), best first:
  exact range → one contains the other → overlap → same chapter. Same book alone is
  **not** shown (it would flood the pane). Within a kind, the link nearest in size
  to the passage first (so a narrow section outranks a broad one for a verse; for
  "same chapter" the nearer verses); then origin: manual, section heading, literal
  mention, inherited. An explicit reference therefore outranks an inherited one
  that is otherwise equal, and a section heading outranks a passing mention of the
  same passage.
- **Grouping:** one place per segment, a source's best three places, the rest
  counted; at most 30 sources per passage. A place that only shares the chapter is
  listed for a source with nothing closer, not as clutter beside its direct places.
- The pane shows direct matches under "Sources for John 15:5", and sources that
  only speak to the same chapter under "Elsewhere in John 15". A v0.4–v0.8 pane
  showed nothing for a verse no source mentioned; it now shows those sources there,
  quietly, as the ranking brief asked.

Opening a place uses the existing `SourceReader`, navigation and history
(`openSource(sourceId, segmentId)`): the same segment window, focus handling and
Reading | Original switch as any other way into a source. No second reader.
Where the reader takes someone to a place (from the pane, a search hit or a
citation), a quiet line beneath it says what it is linked to and why
(`source_segment_passage_links`).

## Original view stays separate

The formatted Original view (EPUB, DOCX, PDF) is for inspection and is
unchanged. References are never detected from the rendered page. The two are
complementary:

```
original file ─────────────→ formatted / original view
normalised segments + structure ─→ passage links ─→ search, citations, source suggestions
```

## Performance

Nothing scans Library text when a Bible page turns: the pane asks one indexed
range lookup, bounded to the passage's book and chapters. Measured in the test
suite (debug build): **12,800 segments, 14,720 links, 168 queries across four
books and every chapter: about 0.5 ms each.**

## Limits, stated plainly

- **English detector.** Headings use the same `ReferenceParser::english()` as body
  text, so they share its false-positive profile (a heading such as "Mark 4
  Principles of Leadership" reads as Mark 4). A heading that is mostly a title
  with an incidental reference is treated as naming it.
- **Structure from strings.** A stored `section_path` joins heading titles with
  " › ". A heading that itself contains " › " is read as nested headings; two
  identical adjacent headings at the same level are one section. Both are
  deterministic and rare.
- **No composition across headings** (a "Chapter 15" heading under "Gospel of
  John" does not become John 15), and **no carry-over from body text** (a
  paragraph mentioning John 15:5 does not change what the next paragraph is
  about).
- **Versification** is not solved: links are canonical Protestant-canon references,
  as in v0.4; cross-versification mapping (Psalms, Malachi, Joel…) is future work
  and nothing here depends on one translation.
- **PDF and plain text** get explicit mentions only.
- **Manual links:** the `manual` origin exists in the model and ranking, but there
  is no interface to create one yet.

## Multilingual reference detection (status: implemented)

References are detected **in the language of the source**, never in the
interface language and never with merged dictionaries.

- **Languages:** English, German, Korean, French, Spanish, Portuguese
  (`scripture::language::ReferenceLanguage`). One normalisation layer accepts the
  forms metadata and people use: `en`/`en-GB`/`en_US`/`eng`/`English`,
  `de`/`deu`/`ger`/`Deutsch`/`German`, `ko`/`kor`/`한국어`/`Korean`,
  `fr`/`fra`/`fre`/`Français`/`French`, `es`/`spa`/`Español`/`Spanish`,
  `pt`/`pt-BR`/`pt-PT`/`por`/`Português`/`Portuguese` (case and accents ignored).
- **Parser selection:** `ReferenceParser::for_language` returns one parser per
  language, built once and cached. `ReferenceParser::english()` remains for typed
  Scripture navigation. A source with no language, or one outside the six, is read
  with the English dictionary (logged, never blocks startup or import).
- **Dictionaries** (`scripture/aliases/`): the 66-book canon, full names,
  standard abbreviations and numbered-book forms per language, with integrity
  tests (66 books, no two books share an alias, every alias reachable). Aliases
  too short or too common to be safe are left out on purpose (for example
  `Am`, `Job`, `Mark`-like English forms, Korean one-syllable abbreviations that
  are everyday words, which need chapter *and* verse). The alias and notation
  tables were written to common abbreviation conventions and checked by
  tests; they are native-style, **not** a certified linguistic review.
- **Notation:** English `John 3:16`; German `Joh 3,16`, `Röm 8,1-4`, `1. Kor`;
  French `Jean 3,16`, `Jn 3,16-18`; Spanish `Juan 3:16` and `3,16`; Portuguese
  `João 3:16` and `3,16`; ranges accept hyphen, en dash and em dash; accented
  and unaccented spellings both match unless the unaccented form is a common word
  (`Rom` the city is not `Röm`; `no_fold` lists).
- **Korean:** `요한복음 3:16`, `3장 16절`, `3장 16-18절`, `3장`, `3-4장`; no
  capital-letter rule; a reference must not sit inside a longer Hangul word, a
  bare number must not be followed by Hangul, and `절` alone is accepted only for
  one-chapter books.
- **False positives:** each language requires a capital (or digit) start where its
  script has one; matches inside longer words, or adjacent to letters, are rejected;
  negative fixtures cover each language.
- **Headings** use the same parser (`sections::derive`), so section/inherited
  links follow the source language too.
- **Preview vs final language:** the preview reads the file with the language
  its metadata names (else English), so its `reference_count` is a best estimate.
  On commit the *final* language the person chose is resolved and the whole
  passage index (explicit and derived) is computed from it; staged links are reused
  only when the language is unchanged. The preview count is not recomputed live when
  the language field is edited (deferred: cheap to add, little value).
- **Existing libraries:** `INDEX_VERSION` is now 2 and covers explicit **and**
  section/inherited links. At startup (after the usual backup) a source below
  version 2 is rebuilt from its stored text and `sources.language` in one
  transaction; `manual` links are never touched; a failure is logged, leaves that
  source as it was and is retried next start; a second run changes nothing. No new
  migration.
- **Offsets:** UTF-16 offsets are preserved (tested with Hangul, accented Latin,
  curly quotes, en and em dashes).
- **Performance note:** regexes use ASCII word boundaries (plus a Unicode
  neighbour check in Rust) because a Unicode `\b` makes the regex engine fall back
  to a slow path on any non-ASCII text.
- **Not done:** Greek and Hebrew (deferred; they fall back to English), versification
  mapping, semantic matching. Reference detection never runs when turning Bible pages.

## Suggestion quality

The Sources pane should read as "what in my library is most relevant to this
passage", not as search results. Everything here is deterministic and explainable;
it reads only indexed links.

**Ranking.** A place's sort key is `(kind, tier, closeness, origin)`, smaller first
(`library/relevance.rs`):

1. *kind*: exact, then contained (one range inside the other), then overlap, then
   same chapter. Decided first, so a mention of exactly John 15:5 outranks a
   section on John 15:1–11 for a reader at John 15:5.
2. *tier*: within a kind, evidence that the text is **about** the passage (a
   section heading, a manual link) before a **passing mention**. A commentary
   section on John 15:1–11, or a section on the whole chapter, outranks a
   paragraph that cites "John 15:5–6" in passing. Not applied to the same-chapter
   kind, where nearness is what matters.
3. *closeness*: the link nearest in size (narrower before broader for a verse;
   nearer verses for the chapter kind).
4. *origin* (manual, section, mention, inherited) so equal evidence always orders
   the same way.

The earlier order "manual, section, explicit, inherited" was kept as the last step;
the new tier makes "section beats a passing mention" hold even when the mention is
slightly closer in size. Origin is never shown to people.

**Source type** (book, sermon, notes …) is deliberately **not** a ranking factor.
Against the acceptance corpus nothing improved by it, and a rule such as "books
before notes" would hide a pastor's own sermon on the verse. Revisit only with a
clear product rule.

**Sources.** One entry per source, ordered by its best place. Between equal best
places, a source with a section or manual link that fits directly (one that is
about the passage) comes before one that only cites it; then title, then id (a
total order, so the same input always gives the same output). How many mentions a
source has never raises its position: a noisy source cannot flood the list.
At most 30 sources are shown.

**Consolidation** (display only; nothing stored is deleted). A source's places are
one per paragraph, best first, then redundant ones are dropped within the same
local context (the section a paragraph lies in, or the paragraph itself):

- a mention inside a section is dropped when the section place (or an earlier
  mention of the same passage) is at least as good a fit: "Section on John 15:1–11
  / Mentions John 15:1–11 / Mentions John 15:1–11" reads as one place;
- a mention that fits the passage **better** than its section, or names a
  different passage, is kept: it is somewhere else worth going.

**Grouping.** Each source shows its best three places and a count of the rest;
the count is of real, distinct places after consolidation. Three was kept: it
shows a source's section and the closest mentions, and a source with fifty
mentions still reads as three places and "47 more". Sources that only share the
chapter are listed apart under "Elsewhere in John 15", after every direct source,
and a source that matches directly never pads itself with same-chapter places.
A "show all places" view was left out deliberately (quality, not features).

**Reasons.** "Mentions John 15:5", "Section on John 15:1–11", "Within section on
John 15:1–11", "Linked to John 15:1–11", in all six languages; no technical
words reach the screen. Korean now reads "요한복음 15:1–11에 관한 부분" ("part about …")
instead of the loan word 섹션. The reader's reason line shows each reason once (a
paragraph that cites John 15:5 three times is explained once), stays small and
muted under the source text, and is shown only where the place is linked.

**Opening.** A result opens through the same source-reader path as everywhere else
(segment id, then the source's own history, Reading/Original mapping): a section
opens at its first paragraph, a mention at that paragraph.

**Language neutrality.** The source language only decides how references are
*detected*; ranking sees canonical passages. The same structure in English, German
and Korean ranks identically, and the interface language never changes the order
(tested).

**Performance** (debug build, large synthetic library of 12,800 segments and
14,720 links, 168 pane queries): before 0.78 ms per query, after 0.87 ms (one
extra indexed lookup per mention that fits the passage); rebuild of the 8 sources
about 0.7 s. No text is scanned and no regex runs when the passage changes.

**Acceptance corpus** (all invented; imported through the real stage/commit/index
path in `src-tauri/tests/suggestion_quality.rs`): a verse-by-verse commentary
(section John 15:1–11, subsection John 15:5, a passing John 15:16), a theology
chapter ("Union with Christ" citing John 15:4–5, no John heading), a sermon
manuscript (John 15:1–8, a Romans citation), personal notes (John 15:5, John
15:12), a general guide (John 15), a same-chapter source (John 15:12–17), a control
("Mark 4 Principles of Leadership"), a German and a Korean source. For John 15:5
the order is: the commentary's exact subsection; the German and Korean sources
(an exact mention in a source that also has a section on it); the notes (a bare exact
mention); the sermon (15:1–8), the guide (chapter); the theology chapter (a passing
mention of 15:4–5); then the same-chapter source under "Elsewhere".

Known behaviour: "Mark 4 Principles of Leadership" is read as a heading on Mark 4
(the parser cannot tell it from a heading on that chapter); it never touches John.

### Manual acceptance checklist (Windows, after v0.9 is merged and published)

1. Read John 15:5; the best commentary or study of the verse is first.
2. Open a section source; it opens at the section's first paragraph with a quiet
   reason line. Press Back to Sources.
3. Open an explicit mention; it opens at that paragraph.
4. Check "Elsewhere in John 15" lists only same-chapter sources, below the direct ones.
5. Switch the interface language: the order stays, the wording changes.
6. Narrow the Sources pane: titles wrap, nothing is cut off, keyboard Tab/Enter work.
7. Check dark mode: reasons readable but quieter than titles; focus ring visible.

## Tests (all text invented)

- `src-tauri/src/library/sections.rs` (derivation rules), `relevance.rs` (ranking).
- `src-tauri/tests/passage_sources.rs`: explicit stays linked; heading → its section;
  sibling boundary; nested headings; several references in one heading; body
  references do not change a section; EPUB, Word and Markdown structure; text and
  PDF are explicit-only; exact / contained / overlap ranking; explicit over
  inherited; one entry per source with a count; opening a result reaches the right
  segment; removed sources never appear; citations unaffected; duplicate behaviour
  unchanged; deterministic rebuild; a source that cannot be rebuilt; thousands of
  segments with timings.
- `src-tauri/tests/migration_v5.rs`: a real v4 library is backed up, upgraded, its
  section links built from stored structure, nothing lost, and a second start does
  nothing.
- `src-tauri/tests/suggestion_quality.rs` (20 tests, corpus above) and `tests/ui/passage-suggestion-quality.test.tsx` (10): ranking, consolidation, caps, range edges, language neutrality, opening.
- `tests/ui/passage-sources.test.tsx` and the updated `library.test.tsx`: grouping,
  reasons, opening in the pane, the reader's reason line, German and Korean.
- `npm run i18n:check`: every string in all six languages.
