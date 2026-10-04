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

## Multilingual reference detection (status: next sub-phase)

`ReferenceParser` already builds from a list of `AliasDictionary` values
(language + book aliases), so another language is a dictionary, not a new parser.
It is **not** done in this checkpoint, deliberately:

- it needs a curated, reviewed alias table per language (English, German, Korean,
  French, Spanish, Portuguese, plus common Greek and Hebrew forms), including
  punctuation conventions (`Joh 3,16`, `요한복음 3장 16절`);
- the detector's capital-letter rule has no meaning for Korean, and short aliases
  collide across languages ("Am", "Job", "Mark"), so merging all dictionaries into
  one regex would raise false positives in every language;
- the right design is to pick the dictionary from the **source's language**
  (the `language` metadata every source has), never to merge them.

So v0.9 keeps `ReferenceParser::english()` for all sources and documents this as
the next v0.9 sub-phase, to be done as its own bounded piece with its own
fixtures. Section links, ranking, grouping and rebuilding are independent of the
language of a reference: when the detector gains a language, the rebuild path
(`INDEX_VERSION`) reindexes existing sources without any other change.

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
- `tests/ui/passage-sources.test.tsx` and the updated `library.test.tsx`: grouping,
  reasons, opening in the pane, the reader's reason line, German and Korean.
- `npm run i18n:check`: every string in all six languages.
