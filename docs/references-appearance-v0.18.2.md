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

- `scripture::resolve::resolve(input, preferred)` reads typed input with
  every pack whose script occurs in it, groups readings by canonical
  reference, and applies the documented tie policy (preferred language,
  then the reviewed packs, then `reference.ambiguous` with the options).
- `scripture_reference_parse(text, language?)` and
  `scripture_reference_detect(text, language?)` are the same commands with
  an optional preferred language; `src/lib/api.ts` sends `i18n.language`.
  No new command; no call site changed its call.
- 94 generated packs beside the six reviewed ones: 100 languages, 30
  scripts, native digits. `ReferenceLanguage::Data(u8)` indexes them.
- Running text keeps its protection: reviewed six plus the source's own pack.

**Call sites reviewed.**

| Call site | Before | Now |
|---|---|---|
| Scripture *Go to passage* (`ScriptureContext.tsx`) | `api.referenceParse` → English parser | same call → shared resolver |
| Study passages (`StudyPassages.tsx`), new study (`NewStudyForm.tsx`) | same | same call → shared resolver |
| Teaching passages (`TeachingLinks.tsx`) | same | same call → shared resolver |
| Presentation editor passage (`PresentationView.tsx`) | same | same call → shared resolver |
| Presenter View *Bible passage* (`PresenterView.tsx`) | same | same call → shared resolver (integration test in `tests/ui/presentation.test.tsx`) |
| Detected references in study notes (`DetectedReferences.tsx`) | English parser only | `Recogniser` for the interface language (reviewed six + that pack) |
| Assistant passage suggestions (`assistant/mod.rs`) | `ReferenceParser::english().parse` | `resolve(r, None)` |
| Sources (`library/passage_index.rs`) | `Recogniser` for the source language | unchanged; a source labelled in one of the 94 languages now reads its own pack |
| Stored canonical values (`ScriptureRef::from_canonical`) | canonical only | unchanged, deliberately |

**Behaviour change.** A source labelled with one of the 94 new languages
(e.g. *Italiano*) used to fall back to English; it now reads with its own
pack (plus the reviewed six). Unlabelled and unknown labels still read as
English.

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
| Body text on page | > 11:1 | Charcoal on Neutral/Parchment … ≥ 11 | ≥ 12.3 (Parchment/Forest) |
| Muted text on side panes | > 5:1 | ≥ 5 | ≥ 6.1 |
| Links, errors on cards | ≥ 4.5:1 | ≥ 4.5 | ≥ 5.9 |
| Focus ring on page | ≥ 3:1 | ≥ 3.0 (deeper brass on Sage and Stone) | ≥ 4.6 |
| Text on selection, notes | > 7:1 | yes | ≥ 10 |
| Borders visible on page / cards | > 1.3 / 1.2 | yes | ≥ 1.6 / 1.5 |
| Pure black | never | — | none |

**Finding fixed:** the brand brass focus ring measured 2.99:1 on light Sage
and 2.91:1 on light Stone (below WCAG 1.4.11's 3:1). Those two backgrounds
now use a brass a shade deeper (`#a3742e`, 3.16–3.61:1). The brand block of
`tokens.css` is unchanged.

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

## 4. Template file formats

Product support: **PowerPoint** — direct .pptx import. **LibreOffice** —
save as .pptx and import that; .odp is not supported. **Keynote** — export
to PowerPoint first. **Google Slides** — download as .pptx first. The owner's
PPTX, ODP and Keynote-roundtrip demo files are kept outside the repository
(not committed, by request).

## 5. Windows acceptance checklist (v0.18.2)

Typed passages (interface in English, then German, then Korean):

- [ ] *Go to passage*: `Johannes 15,5`, `Joh 15,5`, `John 15:5`, `Jean 15,5`, `Juan 15:5`, `João 15:5`, `요한복음 15장 5절` each open John 15:5.
- [ ] *Go to passage*: `约翰福音 15:5`, `Иоанна 15:5`, `يوحنا ١٥:٥` open John 15:5.
- [ ] `Jn 3:5`: English → John 3:5; Portuguese → Jonah 3:5; Korean → a message offering both (in Korean).
- [ ] `John 51` → "John has 21 chapters" in the interface language.
- [ ] Study: add passage `1 Kor 13,4-7` → 1 Corinthians 13:4–7. Teaching: add `Römer 8,28`.
- [ ] Presenter View → *Bible passage*: type `Johannes 15,5`, Enter → John 15:5 shown privately; *Show to audience* works.

Appearance:

- [ ] Settings → Appearance: Dark + each of the six backgrounds — distinct, calm, readable; inputs, cards, selection, hover and focus rings visible.
- [ ] Light + Sage and Light + Stone: the focus ring (Tab through Settings) is clearly visible.
- [ ] *Match my computer*: switch Windows between light and dark (Settings → Personalisation → Colours) with Abiding Word open → the app follows at once, keeping the background family; the swatches change with it.

Presenter View:

- [ ] Default *Follow app*: Dark + Sage → dark sage speaker view.
- [ ] With *Follow app*, switch Windows light/dark during a presentation → the speaker view follows; the audience screen does not change.
- [ ] Choose *Light* in the Presenter View → the app stays dark; leave and re-open the Presenter View → still Light.
- [ ] A church template presentation in Dark + any background → template slides keep their own colours on both screens.

Regression (v0.18 / v0.18.1):

- [ ] Template import from PowerPoint, the designer, PPTX/PDF export, drag-and-drop ordering, audience window, pointer/highlighter, blank, Overview — as in the v0.18.1 checklist.
