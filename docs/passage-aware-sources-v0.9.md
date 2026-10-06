# Passage-aware sources (v0.9)

**Status: merged to `main` (v0.9), then corrected after the first Windows
acceptance, which failed on relevance quality** (see "Windows acceptance finding"
below). The ranking described in the first implementation was **not final**: it is
replaced by the model in "Suggestion quality". Not tagged until acceptance passes.

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

- **Candidates** are explicit, section and manual links that **share a verse** with
  the passage. Inherited links are left out as places: each is represented by its
  section's opening place, and they are by far the most numerous (they are read
  only to learn which section a mention lies in). A link that only shares the
  chapter is **not** offered.
- **Ranking** (`library/relevance.rs`, pure functions with tests): by the class
  below, *about the passage* before *only cites it*. See "Suggestion quality".
- **Grouping:** one place per segment, a source's best three places, the rest
  counted; at most 30 sources per passage.
- The pane shows what fits under "Sources for John 15:5", and says plainly "No
  source in your library is linked to this passage" when nothing does. There is no
  "Elsewhere in John 15" group any more (removed after the Windows acceptance).

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

## Windows acceptance finding (the first v0.9 ranking failed)

The synthetic corpus passed; a real library did not. Reading John 15:5 on Windows:

- an ESV study Bible's *cross-reference sections* ("Cross-references for Matthew
  13:23", whose body says "John 15:5") dominated the list, although they are not
  about John 15:5;
- a Greek New Testament source with a *book-scale range* ("John 11–21") appeared
  very high;
- "Elsewhere in John 15" surfaced John 15:3, 15:8, 15:13: same chapter, not useful
  for the verse.

Opening, Back and the narrow pane were fine. **Root causes** (checked by replaying
these shapes, invented, against the shipped code):

1. The match kind decided first, so *an exact citation anywhere* beat *a section
   about the passage*. A citation inside another passage's section is the usual
   shape of a cross-reference, and it cites the verse exactly.
2. An explicit link carried no information about the section it lay in, so a
   citation under "Matthew 13:23" and one under "John 15:1–11" were identical.
3. Size was measured by verse-key difference with a chapter's end as verse 999, so a
   book-scale range was merely "a bit bigger", still *contained*, still high.
4. A shared chapter number was treated as a (weak) match and shown.

**Parser or ranking?** In every example the parser was *correct*: "Matthew 13:23",
"Mark 4:20", "John 15:5" and "John 11–21" are real references, stored with the right
canonical passage. The fault was relevance, so parsing was not touched (a regression
test pins these shapes, and that prose such as "Saint John arrived, and 15 people
came" is not joined into a reference). The synthetic suite was insufficient because
it had no cross-reference sections and no book-scale heading; the new corpus has.

**No AI, no schema change.** Everything remains deterministic and index-only.

## Suggestion quality

The Sources pane should read as "what in my library is about this passage", not as
search results. Precision is preferred to recall.

### Two questions decide where a place goes

**1. Is the text *about* the passage, or does it only *cite* it?** (`Evidence`)

| Evidence | Meaning |
|---|---|
| About | a manual link; a section whose heading names the passage; a citation **inside** a section whose heading is about the passage |
| Neutral | a citation with no passage-bearing heading around it |
| Cross-reference | a citation inside a section whose heading names a **different** passage |

Which applies to a citation is read from the headings around it: the paragraph's
own section link or an inherited one (already indexed, no schema change), found with
one indexed lookup per citation that shares a verse with the passage. A section only
makes a citation *about* the passage when the section is itself reasonably specific;
a book-scale heading makes it neutral. The citation stays an explicit link
(provenance untouched); only its role as a suggestion changes.

**2. How specific is the link to the passage?** (`Fit`, by chapters spanned, not raw
key distance)

| Fit | Example, for John 15:5 |
|---|---|
| Exact | John 15:5 |
| Narrow | John 15:1–11; a verse inside a chapter being read; a pericope crossing a chapter edge |
| Chapter | John 15 |
| Overlap | partial overlap without containing it |
| Wide | John 14–16 (two or three chapters) |
| Broad | John 11–21, a whole Gospel (four or more chapters) |

### The class (smaller is better)

| class | what | e.g. for John 15:5 |
|---|---|---|
| 0 | a manual link | a link a person confirmed |
| 1 | about, exact or narrow | a section "John 15:1–11 — The Vine" |
| 2 | neutral citation, exact or narrow | "John 15:5 describes abiding" |
| 3 | about, whole chapter or partial overlap | a section "John 15" |
| 4 | wider, or neutral but broad | John 14–16; a neutral chapter mention |
| 5 | cross-reference | "Compare John 15:5" under "Matthew 13:23" |
| 6 | far too broad, whatever the evidence | John 11–21 |

Then, within a class: origin (manual, section heading, mention), fit, and the link
nearest in size. A **section about the passage therefore outranks an exact
cross-reference**, a neutral exact mention outranks a section on the whole chapter
(it is closer to the verse), and a book-scale range is last. Nothing here is a
numeric weight; each rule is a readable function with tests.

A link that shares **no verse** with the passage does not match, even in the same
chapter. The indexed references are all still stored.

The source type (book, sermon, notes …) is deliberately not a factor.

### Sources, consolidation, grouping

- **Sources:** one entry per source, ordered by its best place; between equal best
  places a source with a section or manual link that is about the passage comes
  first; then title, then id (a total order). Many mentions never raise a source.
- **Consolidation** (display only; nothing stored is deleted): a place is dropped
  when an earlier place in the same section (or paragraph) is a section or manual
  link at least as good a fit, or mentions the same passage. A mention that fits
  better than its section, or names another passage, stays.
- **Grouping:** at most three places per source with a count of the rest (distinct
  places after consolidation), at most 30 sources. A source that is all
  cross-references (a study Bible with a hundred) is still one entry.

### Reasons, reader line, language

Plain words only ("Mentions John 15:5", "Section on John 15:1–11", …); no class,
evidence or score is shown, and a cross-reference kept low simply reads "Mentions …".
The reader's reason line, opening, Back and the narrow pane are unchanged. The
source language decides how references are *detected*; ranking sees canonical
passages and the interface language never changes the order (tested).

### Acceptance corpus (invented; `src-tauri/tests/source_relevance.rs`)

A: section "John 15:1–11 — The Vine". B: "Cross-references for Matthew 13:23"
citing John 15:5. C: the same for Mark 4:20. D: section "John 11–21". E: section
"John 15:12–17". F: a neutral paragraph "John 15:5 describes …". For John 15:5 the
order is **A, F, B, C, D**; E is not offered. For John 15:1–11: A, F, B, C, D. For
John 15: A, E, F, B, C, D. For John 15:13: E, then D. Further tests cover a citation
inside a section about the passage (about, not cross-reference), a book-scale heading
(its citations are neutral), a study Bible of twenty cross-references, stable order
and the three languages. The earlier corpus (`suggestion_quality.rs`) was updated
to the new rules.

### Performance

Debug build, large synthetic library (12,800 segments, 14,720 links, 168 pane
queries): **0.87 ms per query as merged in v0.9, 0.80–0.92 ms now (three runs)**: unchanged. The lookup is one indexed
read per citation that shares a verse with the passage; no text is scanned and no
regex runs when the passage changes.

### Korean interface typography

The Korean UI looked thinner and narrower than the Latin. Hangul was not in the
bundled Latin UI font, so it fell to whatever the system chose behind
`system-ui`. Now, for `:lang(ko)` only, the interface stack is Inter (Latin and
digits), then installed Hangul fonts in a fixed order (Noto Sans KR, Malgun Gothic,
Apple SD Gothic Neo, Noto Sans CJK KR), then the system's choice, and the interface
weight is 500 (a face with no 500, such as Malgun Gothic, shows its regular).
Reading text keeps weight 400; Scripture typography, the Latin stacks and every
other language are unchanged; no font file is bundled or downloaded. The tests pin
the stylesheet only: **whether Korean now looks right needs Windows visual
acceptance.**

Known behaviour: "Mark 4 Principles of Leadership" is read as a heading on Mark 4
(the parser cannot tell it from a heading on that chapter); it never touches John.

### Manual acceptance checklist (Windows, after the fix is merged and published)

1. Read John 15:5: sections and studies that are about it come first; a study
   Bible's cross-reference sections ("Cross-references for Matthew 13:23") are below
   them; a book-scale range such as John 11–21 is last.
2. Open a section source; it opens at the section's first paragraph with a quiet
   reason line. Press Back to Sources.
3. Open an explicit mention; it opens at that paragraph.
4. Read a verse only another part of the chapter discusses: the pane says plainly
   that nothing is linked; there is no "Elsewhere" list.
5. Switch the interface language: the order stays, the wording changes. In Korean,
   check the interface type against the Latin (weight, width, headings).
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
- `src-tauri/tests/source_relevance.rs` (12 tests, the Windows acceptance shapes) and the updated `suggestion_quality.rs`; `tests/ui/korean-typography.test.ts` (stylesheet rules only).
- `src-tauri/tests/migration_v5.rs`: a real v4 library is backed up, upgraded, its
  section links built from stored structure, nothing lost, and a second start does
  nothing.
- `src-tauri/tests/suggestion_quality.rs` (20 tests, corpus above) and `tests/ui/passage-suggestion-quality.test.tsx` (10): ranking, consolidation, caps, range edges, language neutrality, opening.
- `tests/ui/passage-sources.test.tsx` and the updated `library.test.tsx`: grouping,
  reasons, opening in the pane, the reader's reason line, German and Korean.
- `npm run i18n:check`: every string in all six languages.
