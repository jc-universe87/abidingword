# Bible-reference language packs

How Abiding Word reads Scripture references in 100 languages, and how to add
the 101st. One engine reads every language; what differs per language is
data. Canonical identity (`JHN.15.5`) never depends on the language a
reference was written in.

## One shared engine

| Layer | Where | Language dependent? |
|---|---|---|
| Canonical identity: the 66 books, chapter counts | `scripture/canon.rs` | no |
| References and validation (`ScriptureRef`, `JHN.15.4`) | `scripture/reference.rs` | no |
| Reviewed lexicons (en, de, ko, fr, es, pt) | `scripture/aliases/<lang>.rs` → `AliasDictionary` | yes |
| Generated lexicons (the other 94) | `resources/scripture/reference-packs.json` → `scripture/data_packs.rs` → `AliasDictionary` | yes (data) |
| Shorthand grammar, list joiners, scripts, ordinary words | `scripture/packs.rs` → `LanguagePack` | yes |
| Normalising (NFC, native digits, full-width punctuation, marks) | `scripture/parser.rs` (`Prepared`, `normalise`) | no |
| Matching engine (`Latin`, `Korean`, `Data` grammars) | `scripture/parser.rs` | no (driven by pack data) |
| **Typed input** (navigation, Study, Teaching, Presenter, assistant) | `scripture/resolve.rs` | no |
| **Running text** (sources, notes) | `scripture/recognise.rs` | no |
| Context (`15:4`, `v. 5`) | `scripture/parser/context.rs` | no (driven by pack data) |

Every place a person types a passage calls the one command
`scripture_reference_parse(text, language)` (`src/lib/api.ts` adds the
interface language) and gets a canonical reference back: Scripture
navigation, Bible Study passage fields, a new study's passage, Teaching
passages, the presentation editor's passage, and the Presenter View's
*Bible passage*. There is no parser of any screen's own, and future mobile
apps use the same command. Canonical-only internal paths
(`ScriptureRef::from_canonical`, stored `JHN.15.5` values) are deliberately
not routed through it.

## Typed input: the policy

`resolve::resolve(input, preferred)`:

1. Every pack whose script occurs in the input reads it as a whole
   (`ReferenceParser::read`). The interface language is **not a gate**: a
   Korean interface reads `Johannes 15,5`.
2. The passages found are grouped by canonical reference. **One passage**
   (however many languages agree) → that passage.
3. **Only generated packs found it** — refused where it would surprise:
   - when the preferred language or a reviewed pack knows the book and says
     the passage is not in it (`Jud 3:5`: Jude has one chapter — not
     Romanian Judges 3:5), that error is the answer;
   - when the book is a **reserved stem** — the bare name of a numbered book
     in a reviewed language that is not a book name itself (`Sam`, `Kön`),
     or a deuterocanonical abbreviation (`Sir`, `Tob`, `Mak`, `Bar`, `Weish`,
     …) — it is `reference.notRecognised` (Malayalam "Sam" is Psalms; Kurdish
     "Şîr", folded, is Proverbs; the person means Samuel or Sirach).
4. **Several passages** — `Jn 3:5` is John in English, French and Spanish
   and Jonah in Portuguese, and Jonah 3:5 exists:
   - the **preferred** (interface) language decides, if it read the input;
   - otherwise **English**, if it read the input — typed passages were read
     in English before v0.18.2, and a German or Korean interface must not
     lose `Jn 3:16`;
   - otherwise, if exactly one of the passages was read by a **reviewed**
     pack, that one;
   - otherwise nothing is guessed: `reference.ambiguous` lists the passages
     (`canonicals`, shown in the interface language) and asks for more of the
     book's name (`фил 1:1`: Philippians or Philemon; `雅 1:1`: James or the
     Song of Songs).
5. **Nothing found:** a spelling that names two books in its own language
   (listed per pack as `ambiguous`) gives `reference.ambiguous` with the
   books; a known book with a passage it does not have gives that error
   (`reference.chapterCount` …), the preferred language's first, then a
   reviewed pack's; anything else is `reference.notRecognised`.

Input longer than 200 characters is not a reference. Only verses' chapters
are checked (`canon` has chapter counts, not verse counts): `Jn 3:16` with a
Portuguese interface opens Jonah 3, whose verse 16 the Bible text does not
have.

A bare book name opens chapter 1. A chapter alone is a chapter. Titles in
《》 or 「」 are read without the brackets; a trailing full stop is ignored.

## Running text: unchanged protection

Detection in sources is deliberately stricter than typed input. A source is
read by the **six reviewed packs plus its own language's pack** (when that is
a generated one): an English sermon never turns an Italian or Polish word
into a reference. Other-language matches must still be strong (a verse
written, not an ordinary word of the source language, one book across the
reviewed packs). Generated packs are not reviewed against the prose of other
languages, so:

- in a cased script (Latin, Cyrillic, Greek, Armenian) a book name must start
  with a capital or digit;
- **only `:` or a chapter/verse unit** separates chapter and verse: `,` and
  `.` between digits are decimals, times and thousands in these languages'
  prose (`3.5万人`, `Op 12.30 uur`, `Rz 2,5 tys.`), and a reference followed
  by `,`/`.` and a digit is dropped whole, never cut short;
- an abbreviation of one or two letters needs a verse; one of three or four
  a verse or a chapter unit; longer names stand alone;
- in a spaced script the match must stand on word boundaries; in an
  unspaced one (Han, Japanese, Thai, Lao, Khmer, Myanmar, Yi) it must not
  touch other digits;
- the reviewed packs' cross-language readings in such a source must also be
  written with `:` or a Korean unit (`Es 3.5 per cento` is not Esther);
- bookless shorthand reads `15:4` only, and never right after a word.

Detection (`scripture_reference_detect`) is not told the interface language:
a study note's language is unknown, so it is read as before (English first).

## Normalising

Before matching, input and running text are prepared without moving offsets
(`Prepared` maps every byte back to the original, so UTF-16 ranges stay
right):

- **Unicode decimal digits** of the scripts below become ASCII: Arabic-Indic,
  Extended Arabic-Indic (Persian, Urdu), Devanagari, Bengali, Gurmukhi,
  Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao,
  Tibetan, Myanmar, Khmer, Ol Chiki, full-width. Only true decimal-digit runs
  are mapped; superscripts, circled numbers, Roman numerals and Ethiopic
  numerals (not decimal) are not chapters.
- full-width `：，．－` and the Arabic comma `،` become `: , . -`;
- zero-width characters, soft hyphens, Arabic short vowels and tatweel, and
  Hebrew points are ignored;
- Greek final sigma is σ; the danda, Ethiopic full stop, maqaf and middle dot
  separate words.

Lexicon keys are NFC and lower case; in cased scripts the accent-free form of
a name is accepted too (`Κατα Ιωαννην` for `Κατά Ιωάννην`), unless it would
be another book's spelling.

## Scripts

`packs::Script` knows 30 scripts: Latin, Cyrillic, Greek, Hangul, Han,
Hiragana, Katakana, Arabic, Hebrew, Devanagari, Bengali, Gurmukhi, Gujarati,
Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Khmer, Myanmar,
Ethiopic, Yi, Ol Chiki, Syloti Nagri, Tibetan, Georgian, Armenian. A pack runs
only over text containing one of its scripts.

## The 100 languages and their provenance

`scripts/scripture/build_reference_packs.py` writes
`resources/scripture/reference-packs.json` reproducibly from two published
sources; nothing is written from memory:

- **Which languages:** Unicode CLDR 48 supplemental `territoryInfo` —
  population per language summed over territories; spoken varieties merged
  into their written standard (Egyptian, Levantine, Maghrebi … Arabic → Arabic;
  Wu, Xiang, Gan → Chinese; Bavarian, Swiss German → German; Lahnda →
  Punjabi; Deccani → Urdu); languages without published book-name data
  skipped (Rangpuri, Magahi, Marwari, Northeastern Thai, Low German, Bambara,
  Baluchi, Minangkabau, Standard Moroccan Tamazight, Mandingo, Bajjika);
  the first 100 kept. Language names come from CLDR.
- **Book names and abbreviations:** the OpenBible.info Bible Passage
  Reference Parser language data (`data/<iso639-3>.yaml`, MIT licence,
  © Stephen Smith). Spellings the data gives to two books in one language
  are kept out of the lookup and listed per pack as `ambiguous`.
- **Reviewed six:** English, German, Korean, French, Spanish and Portuguese
  keep their hand-reviewed dictionaries (`scripture/aliases`).

Known gaps in the data (reported, not filled in): New Testament only for
Bhojpuri, Saraiki, Maithili, Haryanvi, Nigerian Fulfulde and Sichuan Yi;
Wolof lacks 10 books, Sylheti 30, Kurmanji 2 (2 Chronicles, Ezekiel);
Cantonese, Sichuan Yi and Santali are romanised in the data. Han packs use
章 / 节 / 節 as chapter and verse units (the data does not carry them).

| Rank | Language | Code | Script | Pack |
|---|---|---|---|---|
| 1 | English | `en` |  | reviewed |
| 2 | Chinese | `zh` | Han | generated |
| 3 | Hindi | `hi` | Devanagari | generated |
| 4 | Spanish | `es` |  | reviewed |
| 5 | Arabic | `ar` | Arabic | generated |
| 6 | French | `fr` |  | reviewed |
| 7 | Urdu | `ur` | Arabic | generated |
| 8 | Bangla | `bn` | Bengali | generated |
| 9 | Portuguese | `pt` |  | reviewed |
| 10 | Punjabi | `pa` | Gurmukhi | generated |
| 11 | Russian | `ru` | Cyrillic | generated |
| 12 | Swahili | `sw` | Latin | generated |
| 13 | Indonesian | `id` | Latin | generated |
| 14 | Cantonese | `yue` | Latin | generated |
| 15 | German | `de` |  | reviewed |
| 16 | Japanese | `ja` | Katakana | generated |
| 17 | Telugu | `te` | Telugu | generated |
| 18 | Marathi | `mr` | Devanagari | generated |
| 19 | Javanese | `jv` | Latin | generated |
| 20 | Vietnamese | `vi` | Latin | generated |
| 21 | Tamil | `ta` | Tamil | generated |
| 22 | Persian | `fa` | Arabic | generated |
| 23 | Turkish | `tr` | Latin | generated |
| 24 | Korean | `ko` |  | reviewed |
| 25 | Filipino | `fil` | Latin | generated |
| 26 | Italian | `it` | Latin | generated |
| 27 | Gujarati | `gu` | Gujarati | generated |
| 28 | Pashto | `ps` | Arabic | generated |
| 29 | Thai | `th` | Thai | generated |
| 30 | Kannada | `kn` | Kannada | generated |
| 31 | Nigerian Pidgin | `pcm` | Latin | generated |
| 32 | Malayalam | `ml` | Malayalam | generated |
| 33 | Hausa | `ha` | Arabic | generated |
| 34 | Odia | `or` | Oriya | generated |
| 35 | Sindhi | `sd` | Arabic | generated |
| 36 | Polish | `pl` | Latin | generated |
| 37 | Min Nan Chinese | `nan` | Latin | generated |
| 38 | Malay | `ms` | Latin | generated |
| 39 | Amharic | `am` | Ethiopic | generated |
| 40 | Uzbek | `uz` | Latin | generated |
| 41 | Oromo | `om` | Latin | generated |
| 42 | Burmese | `my` | Myanmar | generated |
| 43 | Hakka Chinese | `hak` | Latin | generated |
| 44 | Bhojpuri | `bho` | Devanagari | generated |
| 45 | Azerbaijani | `az` | Latin | generated |
| 46 | Sundanese | `su` | Latin | generated |
| 47 | Dutch | `nl` | Latin | generated |
| 48 | Yoruba | `yo` | Latin | generated |
| 49 | Igbo | `ig` | Latin | generated |
| 50 | skr | `skr` | Arabic | generated |
| 51 | Cebuano | `ceb` | Latin | generated |
| 52 | Awadhi | `awa` | Devanagari | generated |
| 53 | Malagasy | `mg` | Latin | generated |
| 54 | Ukrainian | `uk` | Cyrillic | generated |
| 55 | Nepali | `ne` | Devanagari | generated |
| 56 | Maithili | `mai` | Devanagari | generated |
| 57 | Romanian | `ro` | Latin | generated |
| 58 | Nyanja | `ny` | Latin | generated |
| 59 | Somali | `so` | Latin | generated |
| 60 | Assamese | `as` | Bengali | generated |
| 61 | Madurese | `mad` | Latin | generated |
| 62 | Haryanvi | `bgc` | Devanagari | generated |
| 63 | fuv | `fuv` | Latin | generated |
| 64 | hne | `hne` | Devanagari | generated |
| 65 | Khmer | `km` | Khmer | generated |
| 66 | Zulu | `zu` | Latin | generated |
| 67 | Sinhala | `si` | Sinhala | generated |
| 68 | Serbian | `sr` | Cyrillic | generated |
| 69 | Kazakh | `kk` | Cyrillic | generated |
| 70 | Shona | `sn` | Latin | generated |
| 71 | Akan | `ak` | Latin | generated |
| 72 | Swedish | `sv` | Latin | generated |
| 73 | Czech | `cs` | Latin | generated |
| 74 | Wolof | `wo` | Latin | generated |
| 75 | Hungarian | `hu` | Latin | generated |
| 76 | Greek | `el` | Greek | generated |
| 77 | Kurdish | `ku` | Latin | generated |
| 78 | Kinyarwanda | `rw` | Latin | generated |
| 79 | Quechua | `qu` | Latin | generated |
| 80 | Iloko | `ilo` | Latin | generated |
| 81 | Tajik | `tg` | Cyrillic | generated |
| 82 | Luba-Lulua | `lua` | Latin | generated |
| 83 | Tigrinya | `ti` | Ethiopic | generated |
| 84 | Xhosa | `xh` | Latin | generated |
| 85 | Umbundu | `umb` | Latin | generated |
| 86 | Afrikaans | `af` | Latin | generated |
| 87 | Hiligaynon | `hil` | Latin | generated |
| 88 | Kikuyu | `ki` | Latin | generated |
| 89 | Haitian Creole | `ht` | Latin | generated |
| 90 | Hebrew | `he` | Hebrew | generated |
| 91 | Kimbundu | `kmb` | Latin | generated |
| 92 | Mossi | `mos` | Latin | generated |
| 93 | Krio | `kri` | Latin | generated |
| 94 | Rundi | `rn` | Latin | generated |
| 95 | Sichuan Yi | `ii` | Latin | generated |
| 96 | syl | `syl` | Bengali | generated |
| 97 | Catalan | `ca` | Latin | generated |
| 98 | Uyghur | `ug` | Arabic | generated |
| 99 | Santali | `sat` | Latin | generated |
| 100 | Bulgarian | `bg` | Cyrillic | generated |

The six interface languages (en, de, ko, fr, es, pt) are a separate list:
the interface is translated into six; references are read in 100.

## Adding the 101st language

**From the published data** (the usual way):

1. Check that `Bible-Passage-Reference-Parser-Languages` has
   `data/<iso639-3>.yaml` for it, and that CLDR has its population.
2. Run `python3 scripts/scripture/build_reference_packs.py --cache DIR --fetch`
   with the count raised (or the language added to its selection), then
   without `--fetch` to confirm the output is reproducible.
3. If the language uses a script not in `packs::Script`, add it (name,
   Unicode ranges, cased or not) and, if it writes decimal digits of its own,
   their zero in `DIGIT_ZEROS`.
4. If it writes chapter and verse with units, check `chapterUnits` /
   `verseUnits` in the generated pack.
5. Run `cargo test --test reference_resolver`:
   `every_generated_pack_reads_each_of_its_books` reads every book of every
   pack; add a line for the new script to
   `every_major_script_reads_to_the_same_canonical_passage` with a real name
   from the data.
6. Update the table above and the count in the tests (100 → 101).

**As a reviewed pack** (hand-checked, read in every source): an alias file in
`scripture/aliases/`, a `ReferenceLanguage` variant and labels, a
`LanguagePack` entry in `PACKS`, and the tests the reviewed packs carry
(66 books, no collisions, notation, shorthand, false positives in its prose,
collisions with every other pack via `recognise::contested_names()`, the
fixture matrix in `tests/multilingual_references.rs`). Its rank entry in the
JSON is then marked `curated`.

## Performance

Typed input: a generated pack reads by **lookup** — one small notation
pattern splits book and numbers, then the book is looked up — so resolving
against all 100 packs costs about 1.5–2.5 ms in a debug build
(`reading_typed_input_in_every_language_is_fast`). A generated pack's full
running-text pattern is compiled only when a source in its language is read
(slowest: about 0.6 s once, in a debug build;
`a_generated_pack_reads_a_source_in_its_own_language`). The reviewed packs'
running-text cost is unchanged (`building_and_using_each_parser`).
