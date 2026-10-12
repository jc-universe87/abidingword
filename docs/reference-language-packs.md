# Bible-reference language packs

How Abiding Word reads Scripture references in a language, and how to add a
language. The goal is to grow, over time, toward the most widely spoken
languages; today six packs exist (English, German, Korean, French, Spanish,
Portuguese). A language is claimed only when its pack is complete and tested.

## The layers

| Layer | Where | Language dependent? |
|---|---|---|
| Canonical identity: the 66 books, chapter counts | `scripture/canon.rs` | no |
| References and validation (`ScriptureRef`, `JHN.15.4`) | `scripture/reference.rs` | no |
| Book-name lexicon and explicit notation | `scripture/aliases/<lang>.rs` → `AliasDictionary` | yes |
| Shorthand grammar, list joiners, script, ordinary words | `scripture/packs.rs` → `LanguagePack` | yes |
| Explicit matching engine (one regex per pack) | `scripture/parser.rs` | no (driven by pack data) |
| Weighing packs against each other | `scripture/recognise.rs` | no |
| Context (`15:4`, `v. 5`) | `scripture/parser/context.rs` | no (driven by pack data) |

Adding a language never changes canonical identity, validation, the
weighing policy or context logic.

## What a pack contains

- **Lexicon** (`AliasDictionary`):
  - each book's full name and standard abbreviations, mapped to its canonical
    code;
  - numbered books with their number forms;
  - a strictness per alias (`Full`, `Unit`, `Verse`). An abbreviation that is
    also an ordinary word needs a verse, e.g. German `Mal`;
  - spellings whose accent-free form must not be accepted (`no_fold`, e.g.
    German `röm`).
- **Explicit notation** (`Syntax`): the grammar family (`Latin` or `Korean`
  today), the chapter/verse separators, how a number joins a book name
  (`1. Kor`, `1Kor`, `1º`), and whether a book name must start with a capital.
- **Shorthand** (`Shorthand`):
  - the bookless separator (English `:` only, since `3.16` is a decimal);
  - the verse words (`v.`, `vv.`, `verse`), or none where the verse unit
    follows the number (Korean `절`);
  - whether `,` joins a list.
- **Script:** a pack only reads text containing its script.
- **Ordinary words:** words of this language that must never be read as
  another language's book abbreviation in a source of this language. These
  are **safety exceptions, not stop-word lists**: each entry closes a known
  collision and has its test. Only words certainly ordinary in the language
  belong here, because a word on the list hides a real reference. Never
  extend a list speculatively.
- **Reference lead-ins** (and, where a language writes them after the
  reference, trailing ones): words that introduce a reference in running text
  ("See", "Vgl.", "Voir", "참조"). A line that starts or ends with one is a
  pointer, never a heading line.

## Adding a language

1. **Lexicon from a reliable source.** Take book names and abbreviations from
   a published, maintained reference for that language: a Bible society's
   standard abbreviations, or the abbreviations of its principal
   translations. Record the source in the file. Never write names from
   memory. List what you leave out and why (abbreviations that are ordinary
   words).
2. **`ReferenceLanguage`:** add a variant, its code and its labels (BCP 47 /
   ISO 639 codes, names) in `scripture/language.rs`.
3. **Alias file** `scripture/aliases/<code>.rs`, returning an
   `AliasDictionary`, and a match arm in `aliases::dictionary`.
4. **Pack entry** in `packs::PACKS`: script, shorthand, ordinary words.
5. **A new grammar family** only if the language writes references in a way
   no family covers. Examples: right-to-left scripts, other numerals, or
   chapter and verse words around the numbers. Add it to `Grammar` and the
   pattern builders in `parser.rs`, with tests.
6. **Tests** (all required):
   - every one of the 66 books is named (`aliases` tests do this for every
     pack);
   - no alias points at two books within the pack (`collisions()`);
   - notation: chapter, verse, ranges, cross-chapter ranges, numbered books;
   - shorthand with context, and none without;
   - false positives: ordinary words, times, decimals, dates in that language;
   - **collisions with every other pack**: run `recognise::contested_names()`,
     add a test for each new contested name, and update the expected list in
     `tests/multilingual_references.rs` (a change to that list needs review);
   - reference lead-ins: pointer lines are not headings
     (`tests/contextual_references.rs`);
   - the fixture matrix (`tests/multilingual_references.rs`): the language's
     forms are found in every source language, and the others in its sources.

## Scale

Each pack is one compiled pattern. A pack is only run over text containing
its script, and patterns are built lazily on first use. Before many more
Latin-script packs are added, measure `indexing_a_moderately_large_source_in_each_language_is_quick`.
Consider a shared index from first letters of book names to the packs that
use them, so a paragraph without any candidate name skips most packs. The
weighing policy does not depend on the number of packs.
