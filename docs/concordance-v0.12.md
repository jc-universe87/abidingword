# Concordance and original-language foundations (v0.12)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Concordance](guide/07-concordance.md)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

Status: merged into `main` (`75fe193`) and accepted on Windows (test builds
`0.5.0-dev.25` and later). To be tagged `concordance-v0.12` at `76145c3`, the
last `main` before v0.13 (test build `0.5.0-dev.26`). Built on
`feature/concordance-v0.12` from `main` `c417846`.
**No database migration.** Deterministic only: no AI, no
embeddings, no semantic similarity.

## Scope

A **concordance** answers *where does this form occur?* in one installed Bible:
how often, in which books, in which verses, with each occurrence marked, and
one click to open the verse. It works on its own (Scripture pane →
**Concordance**) and from a word study (**Find occurrences**).

It is **not** a lexicon, a morphology engine, an interlinear or lemma search.
Nothing in the interface offers a lemma or morphology mode, because no
installed Bible carries that data yet (see "Original-language status").

## Terminology

| | EN | DE | KO | FR | ES | PT |
|---|---|---|---|---|---|---|
| the tool | Concordance | Konkordanz | 용례 찾기 | Concordance | Concordancia | Concordância |
| a single word / consecutive words | Word / Phrase | Wort / Wortfolge | 단어 / 어구 | Mot / Suite de mots | Palabra / Secuencia de palabras | Palavra / Sequência de palavras |
| the query field | Word or phrase | Wort oder Wortfolge | 단어 또는 어구 | Mot ou suite de mots | Palabra o secuencia de palabras | Palavra ou sequência de palavras |
| the results | occurrences | Vorkommen | 용례 | occurrences | apariciones | ocorrências |

The second mode matches consecutive words, so its name must not suggest a
Bible passage, an idiom or a sentence: hence *Wortfolge* (not *Wendung*),
*어구* (not *구절*, which also means a verse or passage), *suite de mots* (not
*expression*) and *secuencia / sequência de palavras* (not *frase*).

Korean uses *용례 찾기* ("find usages"): *용례* is already the word-study
term for a word's occurrences; *성구 사전* names a printed concordance and
*성구 찾기* reads as general verse search. Technical words (token, index,
normalised form) never appear in the interface; the only hint is "Finds the
words as this Bible writes them."

## Audit (what existed)

- Verse text: `bible_verse_texts` (one row per translation and verse), with an
  FTS5 index `bible_verse_search` (`unicode61 remove_diacritics 2`: whole
  tokens, case folded, **accents removed**). Its tokens are whole words, so
  "grace" never matched "disgrace"; but it is accent-insensitive (é = e,
  ü = u) and does not ignore Hebrew points, so it cannot be the rule itself.
- Import (USFM only) keeps verse text, superscriptions and the translation's
  language label; `\w word|strong="G1"\w*` keeps the word and **drops** the
  attributes. No lemma, morphology or Strong's data is stored anywhere.
- Study details are a JSON column; a word study already had *word*
  (`lemma`), *language* and a reserved `lexicalId`.
- Migration 0002 already notes that original-language data will attach to
  `bible_verses.id` in a later migration.

## How it matches

**Tokens** are maximal runs of letters, digits and combining marks;
everything else separates them (spaces, punctuation, apostrophes, the Hebrew
maqaf). A **word** query is one token; more than one is refused with "Choose
Phrase". A **phrase** is consecutive tokens, across punctuation ("by grace,"
matches "by grace"); "by the grace" does not.

**Normalisation**, per token and by script (never by guessing a language):

| Script | Rule | Why |
|---|---|---|
| all | Unicode NFC, lower case | composed and decomposed spellings, capitals |
| Latin (EN, DE, FR, ES, PT) | **accents kept**: é ≠ e, ü ≠ u, sé ≠ se | accents distinguish words |
| Hangul (KO) | the written word exactly | no morphology: 은혜를 matches 은혜를, not 은혜 |
| Greek | accents, breathings and diaeresis ignored; ς = σ | accents shift with context (enclitics, elision) |
| Hebrew | points (niqqud) and cantillation ignored | pointed and unpointed texts match |

German ß is kept as ß (no ß/ss folding). Korean words carry their particles
(은혜를, 은혜가), so a Korean search finds the exact written form; a form
without its particle is a different word here. This is honest surface-form
search, not a Korean lemma search.

**The index narrows; the core decides.** For Latin and Hangul queries the FTS
index (looser than these rules) narrows the verses; for Greek and Hebrew the
translation's verses are read directly. Every candidate is tokenised and
checked in the core, which also returns where each occurrence is (UTF-16
offsets) for marking.

## Results and interaction

- Counts: occurrences and verses for the whole Bible; per book, in canonical
  order.
- Up to 200 verses are listed at once, grouped by book. Above that, the books
  are listed with their counts and each opens (`aria-expanded`) to load its
  own verses (`book` parameter), so a common word never ships the whole Bible.
- Each verse is a button ("Open Romans 8:2 in the Bible"): Scripture goes there
  through the v0.11 navigation, so **Back / Forward and Back to {main
  passage} work**, and no Study changes. The concordance keeps its results
  when the Bible is shown again.
- Hebrew text is shown `dir="rtl"` on the verse only; the query box is
  `dir="auto"`; the pane and the references keep the interface direction.
- The result summary is a live status; errors are alerts; an empty result says
  "“zebra” does not occur in this Bible."

## Word Study integration

A word study's details show *Word*, *Language*, and (v0.12) a **Bible** choice
(stored as `translationId` in the existing JSON details: no migration) and
**Find occurrences**, which opens the concordance in the Scripture pane with
the word (Phrase when it has a space) in that Bible. **Nothing is copied into
the study**: the study refers to the word and the Bible; the occurrences are
looked up when wanted.

## Original-language status and the future model

- **Supported now:** surface-form search in any installed Bible, including
  Greek and Hebrew texts, with the normalisation above.
- **Not supported:** lemma, morphology, Strong's or any lexical identifier.
  The USFM importer drops `\w` attributes today; no import keeps them, so no
  such mode is offered. OSIS and USX are not imported.

The future contract, for when an importer can keep such data: a token of a
verse is identified by (`translation_id`, `verse_id`, token index) and has its
surface form and offsets (as `concordance::Token` already computes). Lexical
data attaches to that token in its own table, as separate, optional columns:
lemma text, language, morphology code, and **lexical identifiers as a list**
(Strong's is one scheme among others, never the model). A lemma concordance
would then group tokens by lemma; the surface concordance stays as it is. No
table or field for this is created in v0.12, because nothing can fill it.

## Performance

`cargo test --test concordance -- --nocapture` on an invented 66-book Bible
of 30,914 verses (1,189 chapters):

| Query | Verses | Occurrences | debug | release |
|---|---|---|---|---|
| `the` (in every verse) | 30,914 | 46,370 | 245 ms | 61 ms |
| `grace` (half the verses) | 15,459 | 15,459 | 123 ms | 31 ms |
| a rare word | 287 | 287 | 3 ms | 0.9 ms |
| `by grace` (phrase) | 3,092 | 3,092 | 29 ms | 9 ms |
| `λογος` (full scan, Greek path) | 0 | 0 | — | 46 ms |

Only the books' counts travel for a common word; each book's verses are
loaded when opened.

## Known limits

- Surface forms only; no lemma or morphology (above).
- Korean finds the exact written word, particles included.
- A word split by unusual symbols inside it may be missed by the index
  narrowing (none in Bible text seen so far).
- One Bible at a time; no comparison across translations yet.
