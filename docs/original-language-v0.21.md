# Original-language research (v0.21)

v0.21 lets Abiding Word use the **word annotations a Bible edition itself
carries**: lemmas (dictionary forms), lexical numbers (such as Strong's) and
grammar (morphology) codes, as USFM 3 writes them on each word
(`\w בָּרָא|lemma="1254 a" strong="H1254a" x-morph="HVqp3ms"\w*`). With an
annotated Bible you can:

- search the concordance **by lemma or lexical number**, with homographs kept
  apart, counts by book and every occurrence highlighted;
- narrow the results by **grammar code**, described in words where the
  scheme is one Abiding Word has verified (OSHB Hebrew/Aramaic) and shown as
  written otherwise;
- select words in the reader and open **Word details**: what the edition says
  about each word, how often its entry occurs, *Find this lemma* and *Study
  this word*;
- give a **Word Study** a lexical number and look it up in the chosen edition.

Nothing is looked up elsewhere, nothing is shared between editions, nothing is
inferred, and no AI fills a gap. A Bible without annotations works exactly as
before and the new controls stay out of sight.

User guide: [Concordance](guide/07-concordance.md) (lemma search, word
details, word studies) and [Getting started](guide/01-getting-started.md#add-a-bible)
(what the import preview says).

**No annotated Bible is bundled.** The five bundled Bibles that carry
Strong's numbers in their markup (WEB, BSB, LSG, LUT1912, RV1909) are
Strong's-only and are not indexed (§3). See §9 for which editions you could
add yourself and under what licence.

## 1. What the person sees

| Where | What |
|---|---|
| Add a Bible → review | A summary only when the Bible has word markup: words, verses, how many carry a lemma, lexical numbers, grammar; the grammar scheme; words left out; or why nothing is added (§3). Untagged Bibles show nothing new. |
| Concordance | A third choice, **Lemma**, only for a Bible with lemmas or lexical numbers. Typing a lemma (accents, points and case ignored) or a lexical number lists its **entries**; one entry is opened at once, several are offered to choose from (homographs). The result: occurrences and verses, written forms, **Grammar** (codes with counts, tick to narrow), books in canonical order, verses with each occurrence highlighted. |
| Reader | Selecting words in an annotated Bible adds **Word details** beside Add note and Highlight, only if the selection touches an annotated word. Each word: written form, lemma and lexical number, grammar (described or "code as written"), whether it is a phrase or part of a word, how often its entry occurs, **Find this lemma**, **Study this word** (into the open Word Study, asking before replacing its word). |
| Word Study → information | **Lexical number** next to the word and Bible, and **Find this lemma** when the chosen Bible is annotated; otherwise a quiet note that it is not available for that Bible (shown only when some Bible is annotated or a number is already set). |

Screenshots: `docs/images/original-language-v0.21/` (English at 1280 px in
light and dark; German and Korean at 760 px in light and dark). The annotated
Bible in them is a **constructed sample named "Constructed sample (not Bible
text)"**: invented lines of real Hebrew words with annotations written for
the screenshots.

| File | Shows |
|---|---|
| `v021-lemma-entries-*` | Lemma search for "ברא": two entries (H1254a, H1254b), counts and forms |
| `v021-lemma-grammar-*` | One entry's occurrences, written forms, grammar described in words with the codes, highlighted verses |
| `v021-word-details-*` | Word details for a selected word in the reader |
| `v021-word-study-*` | A Word Study with a lexical number, and its occurrences opened from it |
| `v021-import-words-*` | The import preview's word summary |
| `v021-untagged-concordance-*` | An untagged Bible: Word and Phrase only |

## 2. Reading the markup (`scripture/usfm.rs`, `scripture/words.rs`)

USFM 3 attributes (https://ubsicap.github.io/usfm/attributes/): `name="value"`
pairs after a `|`; a list without `=` is the default attribute (`lemma` for
`\w`); commas separate values, colons separate parts; `x-` names are the
publisher's own.

- **Text first, unchanged.** The reader removes word markup exactly as v0.20
  did, so verse text is byte-identical. A test parses **every book of every
  bundled Bible** with both the v0.20 reader (kept verbatim in
  `tests/support/usfm_v020.rs`) and the new one and compares book code,
  verses, labels, text, superscriptions and unknown markers. The one
  deliberate difference: an attribute value with an escaped quote
  (`lemma="x\"y"`), which v0.20 could not match and so left in the verse text
  as `a|lemma="x\"y"`; v0.21 reads it as an attribute (tested).
- **Placement.** Each attribute list is set aside and a placeholder
  (U+FDD0…U+FDD1, Unicode noncharacters) left where it was; it is given to the
  innermost open `\w`/`\+w`. A file that itself contains those characters has
  its word markup ignored ("unreadable"). Each span is placed in the *stored*
  verse text after white space is collapsed, trimmed to its letters (joiners
  and soft hyphens count as letters here), as **UTF-16 offsets** — the same
  units the reader and highlights use. Surrogate pairs, combining marks,
  Hebrew points and cantillation, Greek polytonic and joiners are tested.
- **Shape.** A span that is exactly one written word is a *word*, several
  written words a *phrase*, part of a written word (`\w un\w*done`) a *part*.
- **Problems** are counted, never half-read, and only for spans that carry
  attributes: unclosed, attribute list with no word, overlapping spans (both
  left out), outside verse text (headings, titles), punctuation only, more
  than 1,000 spans in a verse (all left out, before any per-span work, so a
  crafted file cannot stall the import). Markup without attributes (glossary
  `\w grace\w*`, a stray `\w*`) annotates nothing and is not reported.
- **Attributes** (`words.rs`): `lemma`, `strong` (kept exactly as written;
  every value and part becomes a lexical identifier), `x-morph` or `morph`
  (kept raw). Escapes `\" \\ \| \~ \/`; any other escape, a missing quote,
  pairs not separated by space, an invalid name → the word's annotations are
  refused (*syntax*); one attribute twice with different values, or both
  `x-morph` and `morph` → *conflict*; a list over 2,000 bytes or a value over
  300 characters → *too long*. `srcloc` and other names are recorded by name
  only. Values are data; nothing in them is interpreted.

## 3. What is indexed (`scripture/import.rs`)

`finish_words` decides once per import:

| Outcome | When | The preview says |
|---|---|---|
| indexed | some word has a lemma or a grammar code, and none of the cases below | counts, scheme, words left out |
| `strongOnly` | words carry lexical numbers only | "N words carry lexical numbers only… not used for lemma search" |
| `unreliable` | more than 10 annotated words could not be read **and** more than 1% of them | nothing is added: a partial index would look complete while being wrong |
| `unreadable` | the file uses the placeholder characters | nothing is added |
| `tooLarge` | more than 2,000,000 words | nothing is added |
| (nothing) | no attribute-carrying markup, or nothing indexable and nothing wrong | nothing |

The text is never affected by any of these. The bundled Strong's-tagged
Bibles are `strongOnly`, so their import, size and speed are unchanged (tested
with the WEB).

**Morphology scheme.** A Bible's codes are *described* only if at least 95%
of its Hebrew/Aramaic-looking codes decode with the OSHB table; otherwise
they are kept raw. Even then, each code is described only if it decodes
itself; the interface says "described" only when some listed code is.

## 4. Storage (migration 0017)

Additive, created empty on upgrade; Bibles added earlier gain annotations only
if added again. All of it belongs to one translation and goes with it.

| Table | Holds |
|---|---|
| `bible_word_annotations` | one row per annotated translation (`translation_id` UNIQUE, ON DELETE CASCADE): counts, morphology attribute and scheme, the import report as JSON |
| `bible_lemma_entries` | one row per distinct (lemma, `strong`) of that translation, with `lemma_fold` and its number of occurrences — homographs are different rows |
| `bible_entry_ids` | each lexical identifier of an entry (every value and part of `strong`, as written) |
| `bible_words` | WITHOUT ROWID, key (annotation, verse, position): offsets, written form, shape, entry, morphology code |

Indexes: entries by (annotation, lemma) and (annotation, lemma_fold); ids by
value and by entry; words by (entry, verse, position). Removing a Bible
deletes its words, entries and ids in bulk first, then the translation (the
cascade would do it too, more slowly). The verse key is the canonical
BBCCCVVV; a bridge's words are on its first verse, like its text. Verse
texts are never rewritten after import (`db/text_refresh.rs` refreshes only
library sources), so stored offsets stay valid; a hit whose offsets no longer
fit its text is not highlighted.

**Portability.** Project files (`.awproject`) carry the person's work only:
no Bible and no word index (tested). Backups (`.awbackup`) are the whole
database: words, entries and ids come back with a restore (tested).

## 5. Search (`db/bible_words.rs`, commands)

| Command | Does |
|---|---|
| `scripture_lemma_entries` | entries a typed text names: lemma exactly, lemma folded (accents, points, joiners and case ignored), or lexical identifier (case ignored); most frequent first, at most 30, with up to five written forms each |
| `scripture_lemma_search` | the words of a selection — one **entry** (lemma + identifiers exactly), a **lemma** (all its entries), or a **lexical identifier** — with counts, books in canonical order, verses (all when ≤ 200; otherwise one book at a time, up to 3,000), written forms and grammar codes (counted before any filter), optionally narrowed to chosen codes |
| `scripture_verse_words` | one verse's annotated words with lemma, identifiers, code, description and entry count |

A Bible without annotations answers `words.unavailable` ("The ordinary
concordance still works"). Counts are reproducible: an occurrence is a stored
word, and its highlight is that word's offsets. The surface concordance
(v0.12) is unchanged.

## 6. Grammar codes (`scripture/morphology.rs`)

Only the **Open Scriptures Hebrew Bible** morphology codes are described,
from `HebrewMorphologyCodes.html` (openscriptures/morphhb, CC BY 4.0): a
language letter (`H` Hebrew, `A` Aramaic), then per segment (`/`) a part of
speech and its positional letters (types, person, gender, number, state; for
verbs the stem — separate Hebrew and Aramaic lists — and conjugation, then
person/gender/number or, for participles, gender/number/state); `x` = not
given. The comma form some USFM editions use (`He,R:Ncfsa`) is read too. Every
letter must be in the table or the code is not described at all. Descriptions
are keys translated in all six languages; stems are shown as names.

Greek codes (Robinson, unfoldingWord, MorphGNT and others) are **shown as
written**: their documentation could not be checked for this version, and a
wrong expansion would be worse than none.

## 7. The AI helper

Both assistants' instructions now say: never present a Hebrew, Aramaic or
Greek lemma, lexical number, parsing, etymology or definition as fact unless
the material gives it; anything added about original-language words is
general background to be checked (inquiry: kind "knowledge"). Tested in the
prompt unit tests. Word annotations are not sent to any service.

## 8. Performance

Measured on a **generated whole-Bible fixture** (the canon's real verse
structure, 25 annotated words in each of 31,104 verses = 777,600 words,
6,000 lemmas drawn unevenly, OSHB-style codes; generated test text, not Bible
text) in an optimised build on the cloud development machine
(`cargo test --release --test word_annotations -- --ignored --nocapture`):

| Measure | Result |
|---|---|
| Reading and checking the files (stage) | 5.7 s |
| Writing text and words (commit) | 14.8 s |
| Word index on disk (words, entries, ids; database compacted) | 37.3 MiB (about 50 bytes a word) |
| Peak memory of the import process | 408 MiB |
| Entries for the most frequent lemma | 68 ms |
| All 43,092 occurrences of the most frequent lemma (counts, forms, codes) | 107 ms |
| The same, one book's verses | 110 ms |
| The same, narrowed to one grammar code (7,222) | 101 ms |
| A rare lemma (50) | 1.7 ms |
| A lexical number (1,221) | 10 ms |
| One verse's words (word details) | 0.5 ms |
| Surface concordance, a word with 43,092 occurrences, same Bible (unchanged code) | 153 ms |
| Removing the Bible with its index | 4.7 s |

The bundled Strong's-only Bibles add nothing to the index, so their import
size and time are as in v0.20.

A continuous-integration test runs the same measurement on an eighth of the
Bible in the debug build (about 44,000 words), with every query under 3 s.

## 9. Supported standards and licence audit

| Standard / data | Status in v0.21 |
|---|---|
| USFM 3 `\w`, `\+w` with `lemma`, `strong`, `x-morph`/`morph`, `srcloc` | read (as above) |
| USX, OSIS, Zefania, MySword/e-Sword | not read (no word data from them) |
| OSHB morphology (Hebrew, Aramaic) | described |
| Other morphology schemes | kept and shown raw |
| Lexicons, glosses, definitions | none — not bundled, not generated |

Editions a person might add (not bundled, nothing redistributed by Abiding
Word; each person must check the edition's own terms):

| Edition | Licence as published | Note |
|---|---|---|
| Open Scriptures Hebrew Bible (lemma, morphology) on the Westminster Leningrad Codex | morphology/lemmas CC BY 4.0; WLC text public domain | the form Abiding Word describes |
| unfoldingWord Hebrew Bible / Greek New Testament (UHB, UGNT) | **not verified** (their site could not be reached for this version) | check before use; Greek codes would be shown raw |
| MorphGNT / SBLGNT | MorphGNT CC BY-SA 3.0; SBLGNT text under its own EULA | redistribution conditions apply |
| Byzantine Textform (Robinson–Pierpont) | public domain | Greek codes shown raw |

Tests use only small, **constructed** fixtures labelled as such; the only real
Bibles in tests are the bundled ones, read to check that their text is
unchanged and that their Strong's numbers are reported but not indexed.

## 10. Tests

- `src-tauri/tests/word_annotations.rs`: text identity across all bundled
  Bibles; Strong's-only bundled Bible; offsets (Greek, Hebrew, astral
  characters, joiners, part words); phrases, nesting, escapes; broken markup;
  the escaped-quote difference; a crafted 100,000-word verse; glossary markup
  stays quiet; placeholder characters; preview summary; raw morphology;
  malformed attributes and the unreliable threshold; storage, homographs,
  lemma / lexical-number (any case) / grammar searches, highlights, word
  inspector, unavailable, removal and cascade; upgrade from v16; scale.
- `scripture/words.rs`, `scripture/morphology.rs` unit tests (attribute
  syntax; the documented OSHB examples, participles, stems, both spellings,
  refusals).
- `tests/portability.rs`: project files without, backups with the word index.
- `tests/database.rs`: the schema.
- `tests/ui/original-language.test.tsx` (14): Lemma only for annotated
  Bibles, homographs, highlights and isolated written forms, described and raw
  grammar, narrowing, no entry, word details only for annotated words, Find
  this lemma, Study this word (asking first, never without an open Word
  Study), the Word Study's lexical number, untagged Bibles quiet, the import
  summary, grammar terms in four languages.

## 11. Known limits

- Bibles added before v0.21 must be added again to gain annotations.
- A selection's word details cover the verses of one chapter; at most 12 words
  are listed (the rest are counted).
- An entry list shows at most 30 entries; lexical identifiers include
  prefix parts (OSHB `b`, `c`, `d`), so a one-letter search can be broad.
- The concordance looks up a lexical number through its entries; "every word
  with this number" is reached from a Word Study's lexical number.
- The scheme is decided per Bible; a Bible mixing OSHB Hebrew and another
  Greek scheme describes only the codes that decode.
- No lexicon, gloss, interlinear or cross-edition alignment.
