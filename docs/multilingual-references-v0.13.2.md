# Bible references in any language; heading lines as context (v0.13.2)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Bible references in your books](guide/06-bible-references.md)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

Status: built on the branch `claude/beautiful-curie-vm0eve` from `main`
`f7e4577` (test build `0.5.0-dev.28`). Not merged, not tagged, no Windows
build. **No database migration.** Deterministic only.

## What the acceptance fixture showed, and why

A multilingual sermon (PDF and DOCX) was tested on `0.5.0-dev.28`. The fixture
was reproduced in tests (`tests/multilingual_references.rs`), form by form
and language by language, before anything was changed.

| Observed | Root cause |
|---|---|
| Korean, French, Spanish and Portuguese references not recognised | Every form **is** supported by its own language's parser. A source was read with its own language's parser **only** (`source language == parser language`), so a German or English source never ran the others. |
| German forms inconsistent | In a source filed as English (often the default for a PDF without language metadata), the English parser half-read German: `Joh 15,4` became John 15 (`joh` is an English alias, `,` is not an English verse separator); `Mal 4,3` became Malachi 4; `Johannes 15,5` was not found. Filed as German, all German forms were right. |
| PDF and DOCX differ after "A different section: Romans 8:1–4" | In the PDF that heading is an ordinary paragraph. `8:2` saw two books: the sermon's main passage (John) and the nearby Romans, so it was ambiguous and left alone. In the DOCX the line is a Heading, and a section heading replaces the main passage. Filed as *notes*, the PDF already worked. |
| EPUB | Behaves like DOCX: its headings are structure. |
| Original PDF vs Reading | The same core: explicit references in drawn text use the same detection as the index; bookless ones are looked up from the index for that page (v0.13.1). No separate inference. |
| Order dependence | None found: each parser's lookup is deterministic and context counts books. The new multilingual layer is built not to introduce any (tested). |
| "Jn" and other shared abbreviations | Not safe without a rule: `jn` is John in English, French and Spanish but Jonah in Portuguese; `mc` Micah (EN) / Mark (FR, ES, PT); `hb` Habakkuk (EN) / Hebrews (PT). |

Also fixed: a Korean match could end with a space (`요 15:5 `).

## Architecture

**Before:** one parser per language; a source used exactly one
(`ReferenceParser::for_language(source language)`), for explicit references,
shorthand, headings and drawn text.

**After:**

```
canon (GEN … REV, language independent)
   ▲
ScriptureRef  ◄── every result is canonical
   ▲
Recogniser (scripture::recognise)       ← one per source language
   ├─ explicit references: every LanguagePack, weighed by one policy
   └─ shorthand: the source language's pack only, with context
LanguagePack (scripture::packs)          ← data, one per language
   ├─ lexicon + explicit notation (AliasDictionary, scripture::aliases::<lang>)
   ├─ shorthand grammar: bookless separator, verse words, list joiners
   ├─ script (Latin, Hangul): a pack only reads text containing its script
   └─ ordinary words: never read as another language's book in this language
```

All explicit detection goes through the recogniser: the passage index
(paragraphs and headings), document main passage, section links, and drawn
text (formatted EPUB/DOCX pages, Original PDF pages). Typed navigation and
study passages are unchanged (they parse what the person types).

## Multilingual matching policy

For one text:

1. **The source language reads as before**, with its own false-positive
   policy (capitals, `Mal` needs a verse, Korean strictness, `Röm` not
   `Rom` in German).
2. **Another language's match must be strong:**
   - it names a verse (`Jean 15,4`; `Johannes 15` alone is too weak), except a
     Korean full book name with its chapter unit (`요한복음 15장`);
   - its book name is not an ordinary word of the source language:
     - English: `is`, `am`;
     - German: `am`, `es`, `mal`, `na`, `rom`;
     - French: `es`, `est`;
     - Spanish: `es`;
   - its book name means **one** book across all packs for this reference.
     Books whose chapters cannot hold the reference are set aside, so
     `Jn 15:5` can only be John (Jonah has 4 chapters), while `Jn 3:5` could
     be either.
3. **Overlaps:** the longest match wins (`Joh 15,4` over the English reading
   `Joh 15`). The same text read as different passages is settled by the
   source language if it is among them; otherwise nothing is linked.
   Candidates are sorted by length, then by being the source language, then by
   position, then by canonical text. The order the packs are read in never
   matters (tested by reversing and rotating the candidates).
4. **Shorthand** (`15:4`, `15,4`, `v. 5`, `4절`) is read only in the source
   language's notation, and only with context. It never becomes multilingual
   without context.

**Contested names today:**

| Name | Meanings | Example: always resolved | Example: settled by source language |
|---|---|---|---|
| `jn` | John (EN, FR, ES), Jonah (PT) | `Jn 15:5` → John | `Jn 3:5` (EN/FR/ES → John, PT → Jonah, otherwise none) |
| `mc` | Micah (EN), Mark (FR, ES, PT) | `Mc 10:2` → Mark | `Mc 4:2` |
| `hb` | Habakkuk (EN), Hebrews (PT) | `Hb 10:2` → Hebrews | `Hb 3:2` |

A test fails if this list changes, so any new pack must account for the
collisions it adds.

## Context in PDF, DOCX and EPUB

Context levels, nearest first:

1. **A visible heading line** (new, every format). This is a short paragraph
   that reads as a heading: at most 80 characters, not ending in `.`, `!`, `?`
   or `…`, naming passages of one book. "A different section: Romans 8:1–4"
   qualifies.
   - It governs the following paragraphs like a section heading.
   - It ends at the next heading line (with or without a passage), a new
     section, or after 8 paragraphs.
   - It does not stop at a page break: sections continue across pages.
2. **The section heading** (EPUB, DOCX, Markdown structure).
3. **The document main passage** (sermon or lecture; v0.13.1).

Explicit references in the same paragraph and in the paragraphs just before
are weighed with the nearest of these, as before. Two books in view means no
link.

| Fixture | PDF | DOCX (headings) | DOCX (plain paragraphs) | EPUB |
|---|---|---|---|---|
| main passage John 15:1–11 → `15:4`, `v. 5`, `15:7–8` | ✓ | ✓ | ✓ | ✓ |
| "A different section: Romans 8:1–4" → `8:2`, `v. 3` | ✓ | ✓ | ✓ | ✓ |
| after a new heading line ("Application") → `8:5` | none | — | — | — |
| 9+ paragraphs after the heading line → `8:6` | none | — | — | — |
| main passage John 15–16 → `15:4` ✓, `v. 5` none | ✓ | | | |

One known semantic: in a sermon with a main passage, after a local section
ends, the main passage applies again. A later `8:5` meant for Romans then
reads as John 8:5. Notes, books and documents have no main passage.

The PDF fixture uses ASCII forms only, because the test PDF writer encodes
WinAnsi text. Korean and accented forms are covered through plain text, DOCX
and EPUB, which carry UTF-8.

## Languages supported

Explicit references in **any** source, and shorthand in sources of that
language:

| Language | Explicit | Shorthand |
|---|---|---|
| English | ✓ | `15:4`, `v. 5`, `vv. 7–8`, `verse(s)` |
| German | ✓ | `15,4`, `15:4`, `V. 5`, `Vers(e)` |
| Korean | ✓ | `15:4`, `15장 4절`, `4절` |
| French | ✓ | `15,4`, `15:4`, `v. 5`, `verset(s)` |
| Spanish | ✓ | `15,4`, `15:4`, `v. 5`, `versículo(s)` |
| Portuguese | ✓ | `15,4`, `15:4`, `v. 5`, `versículo(s)` |

No other language is claimed. See
[`reference-language-packs.md`](reference-language-packs.md) for adding one.

## Re-indexing

`sections::INDEX_VERSION` is now 4: every existing source is re-indexed from
its stored text at the next start. Segments, their ids and citations are not
touched (re-indexing replaces only `explicit`, `section` and `inherited`
links, as before).

## Tests

- `tests/multilingual_references.rs` (9):
  - every fixture form alone, in every source language;
  - the whole fixture in one document (paragraphs and one line), identical in
    every language;
  - `jn`, `mc`, `hb` collisions, plus the list of contested names;
  - ordinary words (`mal sehen`, `noch mal 4 Dinge`, `Mal 5 Minuten`,
    `nach Rom 4,3`, `Am 3,5 Uhr`, `Na 2,3 Prozent`, `It Is 5:3`, `I Am 3:4`);
  - a foreign name needs a verse;
  - the sermon through PDF, DOCX (headings and plain paragraphs) and EPUB;
  - no leak after a heading line;
  - the multi-chapter main passage.
- `scripture::recognise` unit tests: order independence; contested names.
- Updated to the new policy: `tests/passage_languages.rs`,
  `tests/source_references.rs`, `library::passage_index` (the language now
  decides priority and shorthand, not what explicit references exist).
