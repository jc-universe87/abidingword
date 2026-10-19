# v0.18.2: passages in 100 languages, dark backgrounds, Presenter View follows the app

Technical record. User-facing descriptions are in the guide
([Bible references](guide/06-bible-references.md#typing-a-passage-in-any-language),
[Settings](guide/08-settings-updates-backups.md#appearance),
[Presenting](guide/11-presenting.md#your-background-in-the-presenter-view)).

## 1. Typed passages: one shared resolver

**Root cause.** `scripture_reference_parse` and `scripture_reference_detect`
were hard-wired to `ReferenceParser::english()`. The multilingual recogniser
(v0.13.2) was only used for sources. So `Johannes 15,5` typed into the
Presenter View's *Bible passage* failed — and so did the same text in
Scripture navigation, a study's passages and Teaching, because every one of
them called the same English-only command. The fix is central, not a
Presenter parser.

**Architecture** (details: [reference-language-packs.md](reference-language-packs.md)):

- `scripture::resolve::resolve(input, Context { bible, interface })` reads
  typed input with every pack whose script occurs in it, groups readings by
  canonical reference, refuses surprising generated-only answers, and then
  decides: **(1) the active Bible translation's language, (2) the interface
  language, (3) the common reading, (4) otherwise ask.** English is no longer
  a hidden fallback; it wins only as the Bible's or interface's language, as
  the only reading, or as part of the common reading.
- The Bible's language comes from the translation's stored language tag
  (`bibles.language_code`, read in the core by translation id through
  `resolve::language_of_tag`); it is never inferred from a name, short name,
  file or publisher. A Bible without a tag skips step 1. No migration. Today
  only the bundled Bibles carry a tag; imported Bibles have none, because
  the import review has no field for it (adding one is a separate change).
- `scripture_reference_parse(text, language?, translationId?)` and
  `scripture_reference_detect(text, language?)`: no new command.
  `src/lib/api.ts` sends `i18n.language`; each typed-entry screen passes the
  id of the Bible it is reading.
- 94 generated packs beside the six reviewed ones: 100 languages, 30
  scripts, native digits. `ReferenceLanguage::Data(u8)` indexes them.
- Running text keeps its protection: reviewed six plus the source's own pack.

**Call sites reviewed.**

| Call site | Before | Now |
|---|---|---|
| Scripture *Go to passage* (`ScriptureContext.tsx`) | `api.referenceParse` → English parser | shared resolver; Bible: the translation being read |
| Study passages (`StudyPassages.tsx`), new study (`NewStudyForm.tsx`) | same | shared resolver; Bible: the workspace's current translation |
| Teaching passages (`TeachingLinks.tsx`) | same | shared resolver; Bible: the workspace's current translation |
| Presentation editor passage (`PresentationView.tsx`) | same | shared resolver; Bible: the presentation's Bible |
| Presenter View *Bible passage* (`PresenterView.tsx`) | same | shared resolver; Bible: the presentation's Bible (integration tests in `tests/ui/presentation.test.tsx`) |
| Detected references in study notes (`DetectedReferences.tsx`) | English parser only | `Recogniser` with English first (reviewed six); the interface language is not sent — it is not the note's language |
| Assistant passage suggestions (`assistant/mod.rs`) | `ReferenceParser::english().parse` | `resolve(r, Context::default())`: no Bible or interface context, so the common reading or nothing |
| Sources (`library/passage_index.rs`) | `Recogniser` for the source language | unchanged; a source labelled in one of the 94 languages now reads its own pack |
| Stored canonical values (`ScriptureRef::from_canonical`) | canonical only | unchanged, deliberately |

**Behaviour change.** A source labelled with one of the 94 new languages
(e.g. *Italiano*) used to fall back to English; it now reads with its own
pack (plus the reviewed six). Unlabelled and unknown labels still read as
English.

## 1a. Priority refinement: Bible language, interface, common reading, ask

The first v0.18.2 policy let the interface language decide and then fell
back to English. The final policy for **deliberately typed** references:

1. the language of the Bible translation being read (stored tag only);
2. the interface language;
3. the common reading — all readings agree, one credible passage remains, or
   a strict majority of the reviewed languages that read the input agree;
4. otherwise `reference.ambiguous`.

The safety rules (generated-only answers vs a known invalid book, reserved
stems, generated packs' restrictions, the length cap, digits, scripts) are
unchanged and apply before the priority. Running-text detection is separate
and unchanged: a source is read in its own language, the interface language
is never sent with it, and generated packs stay stricter in prose.

**Interpretation to note:** the brief asks that `Jn 3:5` with a German
interface and no Bible give John, and that `Jn 3:16` under German and Korean
stay John. German and Korean do not read `Jn`, so neither step 1 nor 2
decides; "common reading" is therefore taken as including a strict majority
of the reviewed languages that read the input (three for John against one
for Jonah). A one-to-one split (`Hb 3:5`) still asks.

## 2. Appearance: a dark variant per family

Six families, twelve palettes in `tokens.css`
(`[data-theme][data-paper]`); the same values in
`src/design-system/palettes.ts` for the swatches and the Presenter View
(a test keeps them identical). `ThemeContext` exposes `resolved`
(light/dark in effect), updated live from `prefers-color-scheme` for *Match
my computer*.

**Contrast** (`tests/ui/appearance-themes.test.tsx`, all twelve):

| Check | Required | Light (lowest) | Dark (lowest) |
|---|---|---|---|
| Body text on page | > 11:1 | ≥ 11 | ≥ 12.3 |
| Body text on cards/panes | > 9:1 | ≥ 11 | ≥ 10.4 (Parchment/Forest, the brand base) |
| Muted text on side panes | > 5:1 | ≥ 5 | ≥ 6.1 |
| Links, errors on cards | ≥ 4.5:1 | ≥ 4.5 | ≥ 5.9 |
| Focus ring on page and panes | ≥ 3:1 | ≥ 3.58 (`#9a6b27`) | ≥ 3.8 (brand brass) |
| Text on selection, notes | > 7:1 | yes | ≥ 10 |
| Borders | decorative | lighter/darker than surfaces | 1.35–1.8 |
| Pure black | never | — | none |

**Findings fixed:** the brand brass focus ring measured below WCAG 1.4.11's
3:1 on several light backgrounds — 2.99 on Sage and 2.91 on Stone pages, and
2.75–2.91 on the Parchment, Cream and Mist side panes. Every light
background now uses a brass a shade deeper (`#9a6b27`, at least 3.58:1 on
all twelve light page and pane colours); dark keeps the brand brass. The
brand block of `tokens.css` is unchanged. **Limitation:** input borders are
decorative (as before, in both themes) and do not reach 3:1; fields are also
identified by their labels and focus ring.

## 3. Presenter View surface

`SPEAKER_APPEARANCES = ["app", "light", "dark", "warm"]`, default `app`.

- **Follow app** uses `APP_PALETTES[resolved][background]` — live, so an OS
  change or a change in Settings reaches an open Presenter View.
- **Light / Dark / Warm** use the fixed presenter palettes
  (`resources/presentation/themes.json`), saved in the device preference
  `presenter.appearance`; never written to the app's theme.
- **Migration:** before v0.18.2 the preference was `presenter.theme` with
  Warm the default. A saved Warm cannot be told from the default, so it now
  follows the app; a saved Light or Dark was a choice and is kept.

**Template separation.** The speaker surface only colours the Presenter
View's own chrome. Slide previews and the audience screen always render with
the presentation's design (`doc.theme`) or its church template pages; an
imported template is never recoloured for dark mode (tested: the slide
preview's style is identical across all four surfaces).

**Built-in audience styling.** Follow app is *not* offered for the audience:
the presentation's Light/Dark/Warm design is saved with the presentation and
is what PowerPoint and PDF exports produce, and what a projector shows
should not change with the speaker's laptop setting. An explicitly chosen
design is never altered.

## 4. Independent review: findings and fixes

| # | Finding | Fix (regression test) |
|---|---|---|
| 1 | Typed `Jn 3:16`, `Mc 3:5`, `Hb 3:5` refused under German/Korean interfaces and dropped by the assistant (v0.18.1 read them in English) | first fixed with an English fallback; replaced in the priority refinement (§1a) by the Bible's language, the interface language and the common reading — `Jn 3:16` is John again by common reading; `Hb 3:5` asks when nothing decides |
| 2 | Chinese/Japanese decimals in running text read as references (`民3.5`, `出3.2`) | generated packs' running text accepts only `:` or units (`running_text_is_not_widened_by_the_generated_packs`) |
| 3 | Dutch/Italian/Polish/Russian decimals and times read as references (`Op 12.30 uur`, `Es 3.5`, `Rz 2,5`) | same; 3–4-letter aliases need a verse or unit; reviewed packs' readings in such sources need `:`; a match followed by `,`/`.`+digit is dropped whole (same test) |
| 4 | Generated packs answered `Sam`, `Sir`, `1 Mak`, `So`, `Jud 3:5` with the wrong book | generated-only answers refused when a known book is invalid or the stem is reserved (`a_generated_pack_never_answers_what_a_reviewed_language_means_otherwise`) |
| 5 | Study-note detection used the interface language as the text's language | detection no longer sent the interface language (`tests/unit/referenceApi.test.ts`) |
| 6 | Digits of scripts without a pack (𝟑, ᠓, ߃, ꘣) gave "John has 21 chapters" | patterns match ASCII digits only after mapping (`script_detection_and_native_digits`) |
| 7 | Ignorable marks after a match were taken into it | `Prepared::original_end` (running-text test) |
| 8 | No length cap on typed input (10k characters ≈ 2.6 s) | 200-character cap (`hostile_or_very_long_input_is_refused_quickly`) |
| 9 | Generated data quality (Greek mixed-script names, missing Japanese abbreviations) | documented as a limitation; the data is not edited by hand |
| 10 | `Script::of` gaps: half-width katakana, 々/〇, Han Extension B+ | added (`script_detection_and_native_digits`) |
| 11 | Light focus ring below 3:1 on some panes; dark Parchment text on cards 10.4:1 vs the comment's 11:1 | deeper brass on all light backgrounds; comment and test state 9:1 for cards (`appearance-themes`) |

Review of the priority refinement (§1a):

| # | Finding | Fix (regression test) |
|---|---|---|
| 1 | Only bundled Bibles store a language tag; imported ones never do | documented in the guide and both records (no import field: out of this change's scope) |
| 2 | A generated Bible language could beat a reading several reviewed languages agree on (Italian Bible: `Gn 3:5` → Jonah, `Ac 3:5` → Habakkuk) | its reading stays credible only when no passage has two or more reviewed languages behind it (`a_bible_language_then_the_interface_then_the_common_reading_then_ask`) |
| 3 | Safety rules beat the Bible's own language (Romanian Bible, `Jud 3:5`) without the docs saying so | documented; test added |
| 4 | ISO 639-2/B and macrolanguage tags (`cmn`, `dut`, `per`, `ara`, `rum`, `cze`, `gre`, `msa`) not mapped | mapped (`a_bibles_language_comes_from_its_stored_tag_only`) |
| 5 | A database error while reading the Bible's tag failed the parse | treated as no signal |
| 6 | The memory test API had a literal English default | the common reading, named as such |
| 7 | Assistant suggestions: `Hb 1:1` now dropped, `Mc` now Mark | accepted and documented (no context in the assistant) |

Checked and fine: no name-based inference; no hidden English fallback; the
majority step decides between books for only `jn` and `mc` among every key
of the six reviewed packs (no bad guesses); every row of the docs table
reproduces; all six call sites pass the right Bible; running-text detection
untouched; no global state, no new strings, no migration.

Checked and fine: the Presentation side uses the shared engine; audience
slides are never recoloured; the Presenter preference migration; radio groups
labelled; Match my computer live; English/German sources not widened; the
tie policy never overturned a reviewed pack's answer (about 2,000 inputs × 7
preferences); script detection and offsets; German "du" in new strings.

## 5. Limitations

- Only chapters are validated (no verse counts in the canon): with a
  Portuguese Bible (or interface) `Jn 3:16` opens Jonah 3, which has no
  verse 16.
- Bibles imported from files carry no language tag (the import review does
  not ask for one), so for them the interface language decides first.
- The generated Italian data lists `Gn` for Jonah; it cannot override the
  reviewed languages' Genesis, but with an Italian Bible and no reviewed
  reading the data is used as published.
- The assistant has no Bible or interface context: an ambiguous abbreviation
  in its suggestions follows the common reading or is left out.
- In running text, generated-language sources find references only with `:`
  or units, so Italian `Gv 3,16` in an Italian book is not linked (typed, it
  is read).
- Generated data is used as published: Greek names partly mixed-script
  (`Ιωάννης` typed alone is not found; `Ιωαννην`/`Κατά Ιωάννην` is), some
  common Japanese abbreviations missing, New Testament only for six
  languages, Wolof/Sylheti/Kurmanji gaps, three romanised packs.
- Input borders are decorative and do not reach 3:1.

## 6. Template file formats

Product support: **PowerPoint** — direct .pptx import. **LibreOffice** —
save as .pptx and import that; .odp is not supported. **Keynote** — export
to PowerPoint first. **Google Slides** — download as .pptx first. The owner's
PPTX, ODP and Keynote-roundtrip demo files are kept outside the repository
(not committed, by request).

## 7. Windows acceptance checklist (v0.18.2)

Typed passages (interface in English, then German, then Korean):

- [ ] *Go to passage*: `Johannes 15,5`, `Joh 15,5`, `John 15:5`, `Jean 15,5`, `Juan 15:5`, `João 15:5`, `요한복음 15장 5절` each open John 15:5.
- [ ] *Go to passage*: `约翰福音 15:5`, `Иоанна 15:5`, `يوحنا ١٥:٥` open John 15:5.
- [ ] Reading the Portuguese *Bíblia Livre* with the interface in English: `Jn 3:5` → Jonah 3:5.
- [ ] Reading the BSB (English) with the interface in Portuguese: `Jn 3:5` → John 3:5 (shown as João 3:5).
- [ ] Reading the Lutherbibel with the interface in German: `Jn 3:16` → John 3:16; `Hb 3:5` → a message offering Habakkuk 3:5 and Hebrews 3:5 (in German).
- [ ] `фил 1:1` → a message offering Philippians and Philemon (in the interface language).
- [ ] `Sam 3:5` → "not a passage I recognise" (not Psalms); `Jud 3:5` → "Jude has only one chapter".
- [ ] `John 51` → "John has 21 chapters" in the interface language.
- [ ] Study: add passage `1 Kor 13,4-7` → 1 Corinthians 13:4–7. Teaching: add `Römer 8,28`.
- [ ] A presentation whose Bible is the Bíblia Livre, interface English → Presenter View → *Bible passage*: `Jn 3:5` → Jonah 3:5; `Johannes 15,5` → John 15:5; *Show to audience* works.

Appearance:

- [ ] Settings → Appearance: Dark + each of the six backgrounds — distinct, calm, readable; inputs, cards, selection, hover and focus rings visible.
- [ ] Light + each background: the focus ring (Tab through Settings and the side panes) is clearly visible.
- [ ] *Match my computer*: switch Windows between light and dark (Settings → Personalisation → Colours) with Abiding Word open → the app follows at once, keeping the background family; the swatches change with it.

Presenter View:

- [ ] Default *Follow app*: Dark + Sage → dark sage speaker view.
- [ ] With *Follow app*, switch Windows light/dark during a presentation → the speaker view follows; the audience screen does not change.
- [ ] Choose *Light* in the Presenter View → the app stays dark; leave and re-open the Presenter View → still Light.
- [ ] A church template presentation in Dark + any background → template slides keep their own colours on both screens.

Regression (v0.18 / v0.18.1):

- [ ] Template import from PowerPoint, the designer, PPTX/PDF export, drag-and-drop ordering, audience window, pointer/highlighter, blank, Overview — as in the v0.18.1 checklist.
