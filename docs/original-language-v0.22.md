# Original-language research: sources, access and usability (v0.22)

v0.21 read word annotations from USFM (`\w …|lemma strong x-morph\w*`) and
described the Open Scriptures Hebrew Bible's morphology codes when nearly all
of a Bible's codes fitted them. v0.22 makes that work reachable for a person
who does not know where Hebrew and Greek study editions come from, and makes
it more careful about what the annotations are:

- **Sources** — which editions can legally be used, what each gives, and how
  to add it (§1). Nothing is bundled.
- **Two importers** — the Open Scriptures Hebrew Bible's OSIS files and
  MorphGNT's text files, plus OSHB's Hebrew-to-English verse map (§2).
- **Import experience** — the review screen says what research data an
  edition has, in plain terms, and the two choices that are the person's (§3);
  an installed Bible can gain or renew its word index without being added
  again (§4).
- **Lexical-number search** for Strong's-only editions, opt-in (§5).
- **Grammar provenance** — a fit is no longer enough to describe codes (§6);
  Robinson's and MorphGNT's Greek codes can now be described (§7).

The user guide pages are [Getting started](guide/01-getting-started.md) and
[The concordance](guide/07-concordance.md). Earlier work:
[original-language-v0.21.md](original-language-v0.21.md).

## 1. Sources and licences

Verified on 2026-10-23 from each publisher's own files (eBible.org detail
pages and the `copr.htm` inside each download; the repositories' README and
LICENSE files; the OSIS headers). The text licence and the annotation licence
are recorded separately: a public-domain text does not make its lemmas or
grammar public domain.

| Edition | Maintainer, where | Version checked | Text | Lemmas / numbers / grammar | Format → Abiding Word |
|---|---|---|---|---|---|
| **Open Scriptures Hebrew Bible** (OSHB) on the Westminster Leningrad Codex | Open Scriptures, github.com/openscriptures/morphhb | `master`, `wlc/*.xml` (39 books) and `wlc/VerseMap.xml` | WLC: public domain (OSIS header `<rights>Public Domain</rights>`) | CC BY 4.0 (OSIS header `<rights type="x-BY">Creative Commons Attribution 4.0</rights>`; VerseMap.xml the same) — attribution required | OSIS → **read (new)**; lexical numbers, grammar described, no lemmas |
| **WLC with OSHB data**, eBible.org `hboWLC` | eBible.org, ebible.org/Scriptures/details.php?id=hboWLC | download of 2026-10 | public domain | "Lemma and morphology data are licensed under a Creative Commons Attribution-ShareAlike license (…/by-sa/3.0/). For attribution purposes, credit the Open Scriptures Hebrew Bible Project." (`copr.htm`) — attribution, **share-alike** | USFM → read; zero-padded Strong's (`H0430`), grammar on 2,352 words only; Hebrew numbering, needs the verse map |
| **MorphGNT** on the SBL Greek New Testament | MorphGNT, github.com/morphgnt/sblgnt | v6.12 (DOI 10.5281/zenodo.376200) | SBLGNT: its own licence (the README points to the SBLGNT EULA; the Logos SBLGNT README v1.2 of 2023-07-10 gives CC BY 4.0) | parsing and lemmas CC BY-SA 3.0 — attribution, **share-alike** | MorphGNT text → **read (new)**; lemmas and grammar, no numbers |
| **Robinson–Pierpont Byzantine Textform 2018**, eBible.org `grcmt` | eBible.org (from byztxt/byzantine-majority-text) | download of 2026-10 | public domain | public domain (Strong's and Robinson codes on all 140,121 words) | USFM → read; numbers; grammar fits Robinson's scheme and the front matter states it |
| **SBL Greek New Testament**, eBible.org `grcsbl` | eBible.org | download of 2026-10 | CC BY 4.0 | Strong's only, CC BY 4.0 | USFM → read; numbers only |
| Byzantine (`grcbyz`), Textus Receptus (`grctr`), eBible.org | eBible.org | download of 2026-10 | public domain | Strong's only | USFM → read; numbers only |
| unfoldingWord Hebrew Bible / Greek NT (UHB, UGNT) | unfoldingWord, door43.org | — | **not verified**: door43.org could not be reached from the development machine | — | USFM would be read; their codes are a scheme Abiding Word does not describe (shown as written) |
| `grcf35` (eBible.org) | | | CC BY-NC-ND | | not suggested: no derivatives |

**Distribution.** None of these is included in Abiding Word, and the app
downloads nothing itself. The Add a Bible screen links to the pages above;
the person downloads and chooses the files. Including any of them (or the
OSHB verse map) in the distributed application needs the owner's decision
first, even where the licence would allow it, and the share-alike terms of
the OSHB/eBible and MorphGNT data would then apply.

Not built: converters for other formats (Zefania, MySword, e-Sword, other
publishers' OSIS, USX). The brief allowed one additional importer only if it
could be completed and tested; two small, well-specified ones (OSHB OSIS and
MorphGNT) were, and nothing partial was added.

## 2. Importers (`scripture/oshb.rs`, `scripture/morphgnt.rs`, `scripture/versification.rs`)

Both are `BibleImportAdapter`s beside USFM; staging, preview, cancel and the
single-transaction commit are unchanged.

**OSHB OSIS.** Only an OSIS file whose header names the work `OSHB` is read
(`osisIDWork="OSHB"`); other OSIS is refused as before, since publishers use
OSIS differently. Read with quick-xml, end names checked:

- verse text: the `<w>` words as written with OSHB's morpheme separators (`/`)
  removed; `<seg>` marks kept where they stand — maqaf (־) and sof pasuq (׃)
  attached to the word before them, paseq and the petuchah/setumah letters as
  written; `<note>` (with the qere readings inside) is not text; a ketiv word
  is the text, as the codex writes it; only the five predefined XML entities
  are resolved;
- words: `lemma` is OSHB's lexical identifier — a Strong's-based number with
  prefix letters and a homograph letter (`c/d/776`, `1254 a`), **not** a
  dictionary form — so it is stored as the word's lexical number as written;
  its numeric parts (`776`, `1254 a`) are the identifiers searched, the prefix
  letters (`c`, `d`, morphemes) are not. No lemma is invented. `morph` is the OSHB code;
- the header's title and the OSHB and WLC rights become the suggested name
  and notice, which the person can change;
- character references (`&#x5E8;`) are decoded; any other entity, or a file
  that cannot be read completely, is an error (`bibleImport.badOsis`), never
  a silent half-book or a silently changed word.

**MorphGNT.** A `.txt` file whose first five lines all have MorphGNT's seven
columns (book/chapter/verse, part of speech, 8-letter parsing, text, word,
normalised word, lemma; books 01–27 of the New Testament). The verse text is
the text column, words joined by single spaces; each word is placed inside its
token (punctuation around it is text, not word). The lemma is a real
dictionary form (λόγος); the code is stored as written (`V- 3PAI-S--`).
Lines that cannot be read are counted (`bibleImport.badLines`): a warning,
or an error when there are more than ten and more than 1% of the book.

**Verse map.** Abiding Word's canon uses the English numbering. A Hebrew text
is renumbered only
with a verse map the person chooses with the files — OSHB's `VerseMap.xml`
(1,979 entries, CC BY 4.0). None is bundled. Rules, validated on the real map
and text:

- entries whose WLC side is a whole verse are applied; the seven whose WLC
  side is part of a verse (`!a`/`!b`) are not, because the text cannot be
  divided at a place the map does not give;
- verses not in the map keep their numbers;
- a mapped verse arriving where an unmapped one already is: in Psalms the
  unmapped one is the title (English Bibles do not number it) and becomes the
  chapter's title, its words left out of the index; elsewhere the two are one
  English verse and are joined in order (exactly four places in the WLC: 1 Sam
  20:42, Num 26:1, 1 Kgs 22:43, 1 Chr 12:4).

A map naming an unknown book, a malformed reference, a different book on each
side or the same source twice is refused whole (`bibleImport.verseMapRefused`,
a warning) — a partly wrong map would move verses silently. The text counts as
Hebrew-numbered when it is OSHB (always the WLC's numbering, whichever books
were chosen) or when any verse is at a chapter or verse number only the
Hebrew numbering has at a place the map names (Joel 4, Gen 32:33, Ps 3:9 …);
then the map is applied. A map on a text already in English numbering is not
used (a note says so). A Hebrew-numbered
text without a map is refused as before (Joel 4 does not exist in English
numbering; the error is given once per chapter), and OSHB input without a map
gets a note saying which file to add.

**Other files read.** Beside the Bible's files, a `copr.htm`, README or
licence (≤ 1 MB each) and USFM front matter (`\id FRT`, `\id INT`) are read
only for what they say about the edition's grammar scheme (§6). Other XML in a
mixed selection is set aside; alone it is refused. All files keep the
existing limits (100 MB in total, UTF-8); an archive entry is never read
beyond the size it declares.

## 3. The import review

Under **Original-language research** the review lists, for the edition's
annotated words: *Written word* (words, verses), *Dictionary form* (words,
different forms), *Grammar* (words with a code), *Lexical number* (words) —
or "not included". Then, only where they apply:

- grammar stated by the edition: "described in words: the edition says it
  uses … (‘…’, in file)";
- grammar that fits a documented scheme without a statement: an **unticked**
  checkbox "Describe the grammar codes as …", with how many codes fit and that
  the edition does not say so;
- codes of no documented scheme: "shown as written";
- lexical numbers only: an **unticked** checkbox "Add a search by lexical
  number", with the estimated size (51 bytes a word, measured in v0.21) and
  that a lexical number is not a definition.

The choice goes with the commit (`CommitImport.words = {numbers, grammar}`).
The core checks it against what it found: a scheme the codes do not fit is
refused (`words.grammarNotFit`), and nothing is added.

The Add a Bible screen has a collapsed **Hebrew and Greek editions for
original-language research** section: the five editions of §1 with what each
gives, how to add it and its licences, and a button opening the publisher's
page in the browser (through the existing checked external-link command). No
catalogue, no background download, no account, no tracking.

## 4. Word information for installed Bibles

Settings → Bible texts → Details → **Word information** shows what the
Bible's index holds and where its grammar description comes from (the
edition's statement and file, or the person's choice). **Look for word
information…** / **Read word information again…** reads the Bible's kept
files again — its managed copy under `sources/bibles/<id>/`, or the bundled
resource — through the same staging, and shows the same summary and choices.

- The text must be **exactly** the stored text, verse for verse
  (`check_same_text`): word offsets point into it. If not, nothing is saved
  (`words.textDiffers`: remove and add the Bible again).
- No kept files: `words.noSource`. Nothing indexable: Save stays disabled
  (`words.nothingToIndex` in the core).
- **Save word index** replaces the old index in one transaction (no
  duplicates, nothing silently replaced: the panel says it replaces it).
  **Remove word index…** asks first and removes only the index; the text,
  notes, studies and the surface concordance stay.

Commands: `bible_words_preview(id)`, `bible_words_apply(previewId, words)`,
`bible_words_cancel(previewId)`, `bible_words_remove(id)`; granted to the
main window only (`permissions/windows.toml`). The preview has its own slot,
apart from an Add a Bible preview (neither replaces the other), is dropped
when the panel closes, and cannot be committed as a new Bible. A re-read
starts from the choices already made for that Bible.

## 5. Lexical-number search

Strong's-only editions (all numbers, no lemmas or codes) are kept at staging
and indexed only on request — at import or later (§4). The bundled Bibles
that carry Strong's numbers are therefore **not** indexed by default: their
import is as in v0.21.

- A Bible with numbers but no lemmas calls the concordance mode **Lexical
  number** (label, hint and heading), not Lemma; an entry without a lemma is
  named "Lexical number G3056", never "(no lemma) · G3056".
- Matching (`bible_words::number_variants`): letter case, leading zeros, a
  missing H/G prefix and the space before a homograph letter are the same
  number (`h430` = `H0430` = `430`, and `H430` also finds OSHB's bare `430`;
  `1254a` = `1254 a`). A bare number in a Bible with both testaments' numbers
  finds the H and the G number as **separate** entries. Nothing else is:
  `G305`, `G30560` and `H3056` are not `G3056`. Identifiers are stored and
  shown exactly as written, prefixes and suffixes kept, per translation.
- An entry carries `matchedId`, the stored identifier the typed text matched;
  when several entries carry it (OSHB `430` and `c/430`) the concordance
  offers **All words with lexical number …**.
- The hint and the guide say plainly that a lexical number points to a lexicon
  entry, is not a definition, and does not prove two words equivalent.

The surface concordance (v0.12) is unchanged.

## 6. Grammar provenance (`scripture/grammar.rs`, migration 0018)

Two separate questions:

1. **Fit** — at least 95% of the coded words decode with a documented scheme
   (OSHB, Robinson, MorphGNT; the best fit is taken). A fit is a check, never
   provenance: codes shaped like OSHB's do not show the publisher used OSHB.
2. **Provenance** — the edition itself names the scheme: its format (an OSHB
   OSIS file names its work `OSHB`; a MorphGNT file is MorphGNT's own format),
   or a statement in its files: "Open Scriptures Hebrew Bible" (OSHB);
   "Maurice A. Robinson" **and** "PARSING CODES" (Robinson); "MorphGNT". A
   statement of one scheme says nothing about codes of another.

Codes are described only with provenance (`grammar_basis = 'edition'`, with
the file and words found as `grammar_evidence`) or the person's choice of the
fitting scheme (`'person'`). Otherwise they are shown as written. Grammar
stays in its optional panel (concordance *Grammar*, word details).

**Migration 0018** (`0018_grammar_provenance.sql`) adds `grammar_scheme`
(CHECK oshb/robinson/morphgnt), `grammar_basis` (CHECK edition/person) and
`grammar_evidence` (JSON) to `bible_word_annotations`, all empty for existing
rows, and sets `morph_scheme = 'raw'` where v0.21 had written `'oshb'` on a fit
alone. Words and codes are kept; the person can choose the scheme again in
Settings. `morph_scheme` now only says whether codes are present; the DTO's
`morphScheme` is `COALESCE(grammar_scheme, morph_scheme)`. `source_format` is
now the adapter's (`usfm`, `osis`, `morphgnt`).

## 7. Greek codes (`scripture/greek.rs`)

Decoded only from the schemes' own documentation, never blended:

- **Robinson** (the specification in the RP2018 edition's own front matter,
  2004): undeclined `ADV CONJ COND PRT PREP INJ` (one suffix allowed),
  `ARAM`/`HEB` transliterated words, indeclinables `N-PRI A-NUI N-LI N-OI`,
  verbs `V-[2]TVM[-PN|-CNG][-ATT]` (the second-form `2` only with future,
  aorist, perfect, pluperfect; infinitives take no tail, participles case,
  number, gender, the other moods person and number), declined forms of
  nouns, adjectives, the article and the pronoun classes (reflexive with a
  person; personal 1st/2nd with case and number only), suffixes `-S -C`
  (degree), `-ABB -I -N -K -ATT`. The data's `2R` second perfects follow the
  rule. **Not described**: possessive pronouns `S-…`, whose data carries a
  possessor-number letter the specification does not document.
- **MorphGNT** (its README): part of speech (`A- C- D- I- N- P- RA RD RI RP
  RR V- X-`) and the eight positions person, tense, voice, mood, case, number,
  gender, degree, `-` meaning not given. **Not described**: the vocative case
  (`V`, 668 words in the data), which the README's case list does not include.

A code that does not decode completely is shown as written. All terms are
translated in six languages (`scripture.morph.*`).

## 8. Demonstration on the real editions

`src-tauri/tests/real_editions.rs` (ignored by default; the editions are not
in the repository) stages each real edition, adds it to an in-memory database
with the choice a person would make, and looks up a verse's words, a lexical
number or lemma, and its occurrences. Run of 2026-10-23, optimised build, the
cloud development machine:

| Edition (choice) | Verses | Review | Word index | Workflow |
|---|---|---|---|---|
| eBible WLC alone | 23,192 | refused: Joel 4 (with the note to add the map) | — | — |
| eBible WLC + OSHB VerseMap.xml | 23,142 | 1,972 renumbered, 4 joined, 67 Psalm titles; 3 verses missing (Neh 7:68, Ps 13:5, Isa 64:1 — split entries not applied) | 299,508 words; grammar stated in `copr.htm` (only 2,352 coded) | Joel 3:1 = WLC 4:1 ("כִּ֗י הִנֵּ֛ה בַּיָּמִ֥ים…"); `H430` → `H0430`, 2,598 in 2,245 verses |
| OSHB OSIS (39 files) + VerseMap.xml | 23,142 | same as above | 305,136 words, every one with number and grammar, all described (stated by the format) | Gen 1:1 `b/7225` "preposition + noun…"; `430` → 13 entries (`430`, `d/430`, `l/430`…), all words 2,598 |
| Robinson–Pierpont 2018 (`grcmt`) | 7,957 | 4 empty verses (the edition omits them) | 140,121 words; Robinson stated in the front matter; 139,998 described (the rest: possessives) | John 1:1 "noun · nominative · singular · masculine"; `3056` → `G3056`, 331 in 317 verses |
| Byzantine (`grcbyz`, numbers ticked) | 7,958 | Mark 7:16 absent | 137,573 words, numbers only | `G3056` 331 in 317 verses |
| Textus Receptus (`grctr`, nothing ticked) | 7,957 | — | none (as chosen) | — |
| SBL (`grcsbl`, numbers ticked) | 7,939 | the verses SBLGNT omits | 136,377 words, numbers only | `g3056` → `G3056`, 330 in 318 verses |
| MorphGNT (27 files) | 7,927 | the verses SBLGNT omits (incl. John 7:53–8:11) | 137,554 words, 5,461 lemmas; 136,886 described (the rest: vocatives) | `λογος` → λόγος, 330 in 318 verses |

The eBible RP2018 text is written without accents and with medial sigma
(`λογοσ`), as the edition publishes it; Abiding Word keeps it as written.

## 9. Measurements

Same run. Staging (reading and checking) and adding (one transaction):

| Edition | Staged | Added (text + words) | Verse words | Number / lemma lookup | All occurrences |
|---|---|---|---|---|---|
| eBible WLC + map | 1.6 s | 4.2 s | 0.2 ms | 12 ms | 11 ms |
| OSHB OSIS + map | 0.7 s | 4.4 s | 0.2 ms | 66 ms (13 spellings × entries) | 27 ms |
| RP2018 | 0.8 s | 1.7 s | 0.3 ms | 7 ms | 4 ms |
| SBL (numbers) | 0.7 s | 1.7 s | 0.2 ms | 5 ms | 3 ms |
| MorphGNT | 0.2 s | 1.7 s | 0.2 ms | 4 ms | 1 ms |

v0.21 measured a generated 777,600-word Bible at 5.7 s staging, 14.8 s commit
and 68–107 ms for the largest lemma; the real editions are smaller and within
those figures. The surface concordance is unchanged.

**Bundled Bibles with Strong's numbers** (what the opt-in costs; not done by
default):

| Bible | Words with numbers | Text only | Text + number index | Index size (estimate shown to the person) |
|---|---|---|---|---|
| BSB | 630,006 | 1.8 s, 11.2 MiB | 7.0 s | +26.6 MiB (30.6) |
| WEB | 683,869 | 1.6 s, 11.3 MiB | 7.4 s | +29.4 MiB (33.3) |
| LUT1912 | 365,353 | 1.6 s, 11.4 MiB | 4.7 s | +16.3 MiB (17.8) |
| LSG | 705,605 | 1.8 s, 11.8 MiB | 8.3 s | +30.6 MiB (34.3) |
| RV1909 | 390,758 | 1.6 s, 11.2 MiB | 4.9 s | +18.7 MiB (19.0) |

An index roughly triples a bundled Bible's storage and adds 3–7 s to adding
it, for a search most readers of a translation will not use; so it stays
opt-in, per Bible. The estimate (51 bytes a word) is a slight overestimate.

## 10. Independent review

A reviewer with no part in the work read the whole change and checked every
word offset of the real OSHB (305,136 words) and MorphGNT (137,554) imports
against the verse text: no mismatch, no overlap. Findings, all fixed:

| # | Finding | Fix |
|---|---|---|
| 1 | A single Hebrew book without Joel/Malachi, with the map, was not renumbered, and the note said it already followed English numbers | OSHB input, or any verse at a Hebrew-only number the map names, is Hebrew-numbered; OSHB without a map gets the note |
| 2 | A Settings word preview replaced an Add a Bible preview (one shared slot) | own slot, cancel command, dropped on close |
| 3 | `H430` did not find OSHB's bare `430` | the bare number is also tried |
| 4 | OSHB prefix letters (`c`, `d`) were searchable as lexical numbers | only numeric parts are identifiers |
| 5 | A re-read forgot the person's earlier grammar choice | starts from the current choices |
| 6 | Unknown entities in OSIS were dropped silently | character references decoded, others refused |
| 7 | The Joel 4 error repeated per verse | once per chapter |
| — | (older) an archive entry could expand beyond its declared size | read at most the declared size |

## 11. Tests

- `src-tauri/tests/original_language.rs` (14, constructed fixtures labelled
  as such): OSHB words, marks, notes, ketiv and identifiers without invented
  lemmas; header name and licence; the verse map applied, unused, refused;
  Psalm titles and joined verses; Hebrew numbering without a map refused with
  advice; broken and foreign XML; OSHB number search and stated grammar;
  MorphGNT lemmas, placement, stated grammar and the undescribed vocative;
  malformed MorphGNT lines; Strong's-only opt-in and number spellings (and
  near misses refused); variants; fit vs statement vs choice (Robinson raw,
  chosen, refused when not fitting, stated in front matter, a statement of
  another scheme ignored); re-indexing an installed Bible (replace, not
  double; text unchanged; changed text and nothing-indexable refused);
  migration 0018 from v17 with backup; oversized notes ignored.
- Unit tests: `scripture/greek.rs` (documented examples and refusals),
  `scripture/grammar.rs`, `scripture/versification.rs`.
- `tests/ui/original-language.test.tsx` (21): the plain-language summary, the
  stated grammar with nothing to choose, the unticked scheme choice reaching
  the commit, the unticked number search with its size, the Lexical number
  mode and spellings, Settings word information (preview, opt-in, save,
  remove; files not kept), the guide's links, Greek terms in six languages.

## 12. Limits

- No lexicon, gloss, interlinear or cross-edition alignment; numbers are
  searched within one Bible.
- Only OSHB's OSIS is read; other OSIS, USX, Zefania and similar are refused.
- Verse-map entries that split a Hebrew verse are not applied; the English
  verse they would begin may be missing (the review's verse checks say so).
- Robinson possessive pronouns and MorphGNT vocatives stay as written.
- Re-reading word information needs the kept files; Bibles whose copy is gone
  must be added again.
