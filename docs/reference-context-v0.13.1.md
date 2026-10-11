# Bible references with and without a book name; v0.13 acceptance fixes (v0.13.1)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Bible references in your books](guide/06-bible-references.md)** and **[Your library](guide/05-library.md)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

Status: built on the branch `claude/beautiful-curie-vm0eve` from `main`
`d8d2ecd` (test build `0.5.0-dev.27`). Not merged, not tagged, no Windows build.
**No database migration.** Deterministic only: no AI, no semantic matching.

Three acceptance issues from `0.5.0-dev.27`:

1. [EPUB character references still shown literally](#1-epub-character-references)
2. [Long contents panels](#2-collapsible-contents)
3. [References written without a book name](#3-references-with-and-without-a-book-name)

## 1. EPUB character references

**What was seen:** `&dagger;` shown literally in a real book.

**What was found.** Decoding itself was right: every path through both EPUB
parsers (Reading extraction, formatted Original view, contents titles,
attributes) sends each reference once through the same single-pass decoder,
and `dagger` is in its table. Probing the real pipeline found two other defects:

- **Stored text from earlier versions.** The Reading view shows the text
  stored at import. Before v0.13 only thirteen references were decoded (no
  `dagger`, no `bull`), so books imported with `0.5.0-dev.26` or earlier still
  had `&dagger;` in their stored text. The Original view re-reads the file and
  was already right, which is why the two views could disagree.
- **A stray `&` ended the chapter.** quick-xml stops with an error at an `&`
  that does not start a complete reference (`Q&A`, `a & b`, `&dagger` without
  its `;`, `&#8224` without its `;`). The parsers then stopped, and **the rest
  of that document was silently lost** in Reading and Original.

**Fix.**

- Every EPUB reader now keeps such an `&` as text (`allow_dangling_amp`,
  `adapters::epub::tolerant_reader`). It is shown as written, never guessed.
- `db::text_refresh` re-extracts imported EPUBs from their managed copies,
  once per extraction improvement (settings key `library.extractionVersion`,
  now `2`, checked at startup). Segments are updated **in place**:
  - a paragraph still present keeps its segment id, so citations keep working
    (matching ignores what better decoding changes);
  - paragraphs lost after a stray `&` are added;
  - paragraphs no longer found are removed (a citation of one keeps its
    quotation and locator);
  - the passage index is rebuilt.
  A source whose file cannot be read is left as it was and tried again at the
  next start. Stored text is never decoded a second time.
- Single-pass semantics are unchanged: `&amp;dagger;` reads `&dagger;`.

| Written | Read |
|---|---|
| `&dagger;` `&#8224;` `&#x2020;` | † |
| `&bull;` | • |
| `&amp;dagger;` | `&dagger;` (once, never recursively) |
| `&unknownname;` | `&unknownname;` |
| `Q&A`, `a & b`, `&dagger` (no `;`) | as written; the rest of the document is kept |

Decoded text is always a text node: no `innerHTML`, sanitisation unchanged.

## 2. Collapsible contents

The Contents panel (native and generated contents alike) keeps the source's
hierarchy but folds deeper levels:

- The top level is always shown. An entry with subsections has its own arrow
  button, which has `aria-expanded`, `aria-controls` and a name ("Show the
  subsections of …").
- When the panel opens, **only the entries leading to the current one are
  unfolded**, so the current place is in view and nothing else is expanded.
  A huge book opens as a short list.
- A folded branch that holds the current place is marked as current and says
  so to screen readers ("contains the current section").
- A quiet **Expand all / Collapse all** button appears only when something
  can be folded.
- Keyboard: Tab reaches each arrow and each entry; Enter or Space activates;
  Escape closes. Choosing an entry navigates and records Back / Forward
  exactly as before.

## 3. References with and without a book name

### Explicit references (unchanged)

A reference written with its book, in the **source's** language (never the
interface language). Notation per language, as the parser has accepted since
v0.11:

| Language | Chapter : verse | Ranges | Notes |
|---|---|---|---|
| EN | `John 3:16`, `John 3.16` | `3:16-18`, `3:16–4:2` | spaces allowed around `:`; `.` only between digits |
| DE | `Joh 3,16`, `Joh 3:16` | `3,16-18` | `,` only between digits; numbered books `1. Kor`, `1Kor` |
| FR | `Jean 3,16`, `Jean 3:16` | `3,16-18` | as German |
| ES | `Juan 3,16`, `Juan 3:16` | `3,16-18` | as German |
| PT | `João 3,16`, `João 3:16` | `3,16-18` | as German; `1º Coríntios` |
| KO | `요한복음 3:16`, `요 3:16` | `3:16-18`, `3장 16-18절`, `3장 16절-4장 2절`, `3-4장` | units 장 / 편 / 절; short aliases that are ordinary words need a verse |

A semicolon is never a chapter/verse separator.

### Contextual references (new)

Sermons, commentaries and study books name the book once and then write
`15:4`, `15,5–6`, `15장 4절`, or just `v. 4`. These are now resolved by
**deterministic reference resolution** (`scripture::parser::context`). A
bookless reference takes its book (and, for verse-only shorthand, its
chapter) only from explicit references the source wrote nearby, and is left
alone whenever that context is missing or names more than one passage.

**Bookless forms**, in each language's own notation:

| Language | Chapter : verse | Verse-only shorthand | Joins a list |
|---|---|---|---|
| EN | `15:4`, `15:5–6`, `15:26–16:4` (`:` only; `15.4` is a decimal) | `v. 4`, `vv. 7–8`, `verse 5`, `verses 7–8` | `;` or `,` |
| DE | `15,4`, `15:4`, `15,5–6` | `V. 4`, `Vv. 7–8`, `Vers 5`, `Verse 7–8` | `;` |
| FR | `15,4`, `15:4` | `v. 4`, `vv. 7–8`, `verset 5`, `versets 7–8` | `;` |
| ES | `15,4`, `15:4` | `v. 4`, `vv. 7–8`, `versículo 5`, `versículos 7–8` | `;` |
| PT | `15,4`, `15:4` | `v. 4`, `vv. 7–8`, `versículo 5`, `versículos 7–8` | `;` |
| KO | `15:4`, `15장 4절`, `15장 5-6절` | `4절`, `7-8절` | `;` or `,` |

**Where the book comes from**, for one paragraph:

1. **A reference list:** a bookless reference directly after another
   reference, joined only by `;` (or `,` where `,` is not a verse separator),
   continues it. `John 15:4; 15:7; 16:1` gives John 15:4, 15:7, 16:1.
2. **Otherwise** the books of explicit references in scope are gathered:
   - earlier in the same paragraph;
   - in the paragraphs just before;
   - in the section heading.
   Exactly one book links; two or more is ambiguous and nothing is linked.
   So a new explicit book replaces the context in a list
   (`Romans 8:1; 8:28`), but `John 3:16 and Romans 8:1 … 5:8` links no `5:8`.
3. **Verse-only shorthand** needs one book *and* one chapter: a passage within
   a single chapter. The sermon titled `John 15:1–11` resolves `v. 4` to
   John 15:4 and `vv. 7–8` to John 15:7–8. A heading of `John 15–16`, or a
   second passage in view, resolves nothing.

**Context boundaries** (`ContextTracker`):

- **Sources with headings (EPUB, Word, Markdown):**
  - The deepest heading in the section path that names passages is the
    section's context for all of its paragraphs.
  - Explicit references in a paragraph count for the next 8 paragraphs of
    the same section.
  - Any change of section starts afresh.
- **Sources without sections (PDF, plain text):** explicit references count
  for the next 2 paragraphs on the same page; a new page starts afresh.
- The canonical result is always explicit (`JHN.15.4`); the visible text is
  stored as written (`15,4`).

**False-positive protection.** Without context nothing is ever linked. With
context, a candidate is still rejected when it is:

- part of a longer number: `3.14.15`, `2,5,7`, `3:16:2`, or written straight
  after a number;
- written with a leading zero: `1:05`;
- followed by a time or unit: `10:30 Uhr`, `1:30 pm`, `2,5 km`, `3,5 %`,
  `a 3:1 ratio`;
- after a time word with two-digit minutes (`at 10:30`, `um 9:45`, `à 10:30`,
  `a las 10:30`, `às 10:30`, `오후 1:30`), while `look at 15:4` is a verse;
- after a ratio or score word: `score of 2:1`, `3:1 gewonnen`;
- after an unknown capitalised word mid-sentence: German `nach Rom 4,3`, where
  Rom is the city;
- after a book name in another script: `요한복음 3:16` in a German source.

English `.` and the comma languages' decimals stay decimals (`3.14`,
`2026.10` are never bookless references).

**Where they work:**

- **Reading view and the Sources pane:** from the passage index. Contextual
  references are stored like explicit ones, with their offsets and visible
  text, so they open in the Bible and count as mentions.
- **Formatted EPUB / Word pages and Original PDF pages:** drawn text does not
  carry the source's structure, so context is **never inferred from it**.
  The viewer names the part it draws (the document's segment range, or the
  PDF page). A bookless reference there is linked only if the imported text
  of that part resolved the same visible text to one passage and no other.
  For PDFs the index supplies the passage and PDF.js only the place on the
  page; the two representations are not merged, and earlier pages are never
  consulted.

**Re-indexing:** `sections::INDEX_VERSION` is now 3, so every existing source
is re-indexed from its stored text at the next start (no re-import, no
migration). The EPUB text refresh (section 1) runs first, then re-indexes
what it repaired.

### Known limits

- Chapter-only bookless references (`chapter 16`, `16장`) are not resolved.
- Context does not cross sections or pages, and does not survive 8
  paragraphs (2 without sections) without an explicit reference; the
  section heading lasts for its whole section.
- A reference whose visible text resolved differently in two places of the
  same formatted document (or PDF page) is not linked there.
- Mid-sentence capitalised words block a following bookless reference, which
  costs some German recall (`die Stelle 15,4`).
- `vv. 7f` / `ff.`, and verse lists such as `vv. 4, 7`, are not read.
- Times written without a time word, unit or leading zero (`10:30` alone in a
  John section) can still read as a verse.

## Tests

- Rust:
  - `tests/contextual_references.rs` (17): lists, headings, a new book, section
    reset, expiry, page bounds, no context, and times, decimals, dates,
    ratios and units in five languages;
  - each language's notation, the sermon case, verse shorthand in all six
    languages, the passage index;
  - `tests/source_references.rs`: drawn-text lookup by scope, and ambiguity;
  - `tests/epub_view.rs`: dagger, numeric, hex, `&amp;dagger;`, unknown names,
    paragraphs, emphasis, links, lists, a stray `&`;
  - `tests/text_refresh.rs`: in-place repair, kept ids, lost paragraphs,
    re-index, once only, a missing file.
- Interface:
  - `tests/ui/source-contents.test.tsx`: folding, the current path unfolded,
    a folded branch holding the current place, Expand all, keyboard;
  - `tests/ui/pdf-interactive.test.tsx`: a bookless reference on a PDF page,
    and the same text on another page left plain.
