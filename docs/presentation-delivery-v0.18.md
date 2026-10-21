# Presentation & Delivery Foundation — v0.18

Status: built on branch `claude/beautiful-curie-vm0eve` (base `main` at
`9533acb`, v0.17 merged). Not merged, not tagged, no test build.

## 1. What this milestone is

A **presentation is how one Bible Teaching is delivered**. It is an output
layer of the teaching, not a third workspace beside Bible Study and Bible
Teaching:

- the **teaching stays the source of truth**; a presentation never copies
  the teaching's text into slides that would then drift apart;
- a presentation only says **which parts of the teaching are shown, in which
  order, where the slide breaks are, what the audience sees and what only the
  speaker sees**;
- the same presentation feeds the **live Presenter View and audience screen,
  PowerPoint, PDF (slides and a speaker sheet), Markdown and a delivery
  package**. There are no separate PowerPoint or PDF editors.

It is reached from the teaching itself (a quiet **Presentation** button next
to *About this teaching*) and goes back to it with *Back to the teaching*.

## 2. Audit of the teaching model (before any change)

What v0.16/v0.17 already give, and how v0.18 uses it:

| Teaching data (migrations 0008, 0009) | Used for |
|---|---|
| `teaching_preparations`: title, kind, central message, introduction, conclusion, notes | title slide, central-message slide, spoken introduction/conclusion (speaker only); the teaching's own `notes` stay private and are **not** used |
| `teaching_points` (ordered; `kind` for lesson steps: text, scripture, question, activity, image) | one slide per point/step: heading, question or activity; explanation / application / illustration become the speaker's manuscript |
| `teaching_passages` (canonical refs, whole teaching or per point) | Scripture slides, text quoted from an installed Bible on this computer |
| `teaching_materials` (kept images with source/licence or *generated* standing; stories and illustrations with standing and sources) | image slides with credit and "generated" marking; text/quote slides; citations |
| `teaching_finding_links` (study notes, live) | a slide can show a note's text |

The model is ordered and id-stable, so presentations can point at its parts
without changing it. **Nothing in the teaching tables is changed by v0.18.**

## 3. Data model — migration 0010 (additive), 0011 (target time)

`src-tauri/migrations/0010_presentations.sql` adds two tables; no existing
table or row is touched. It runs like every migration: a verified backup
first (`pre-migration/abiding-word-v9-….db`), its own transaction, and a
repeatable start (a second start makes no second backup). Migration 0011
(`0011_presentation_target.sql`) adds one nullable column,
`presentations.target_minutes`, for the optional target time (§23).

```
presentations        id, preparation_id → teaching_preparations (cascade),
                     title, theme (light|dark|warm), translation_id (NULL: the
                     Scripture pane's Bible), position, created/updated/deleted_at, revision
presentation_items   id, presentation_id → presentations (cascade), position,
                     kind, source_kind/source_id/source_field (the teaching part
                     it follows; NULL: the presentation's own slide),
                     heading, body, reference (NULL: follow the teaching),
                     notes (speaker only), skipped (left out, kept),
                     created/updated/deleted_at
```

A teaching may have **several presentations** (e.g. a 20-minute and a
40-minute version). Deleting a presentation (soft delete) never touches the
teaching; deleting the teaching takes its presentations with it.

Tests: `src-tauri/tests/migration_v10.rs` writes a schema-9 database with
plain SQL (a children's lesson with step kinds and a passage), upgrades it,
checks the backup, that the teaching is exactly as before, that no
presentation is made by itself, that a proposal works on the old teaching
and leaves its revision unchanged, and that a second start changes nothing.

## 4. Link versus snapshot

- **While preparing, items are live links.** An item names the part of the
  teaching it shows (`point:<id>`, `passage:<id>`, `preparation:<id>:central_message`, …).
  Its heading and audience text are `NULL` and **follow the teaching**: edit a
  point's title in the teaching and the slide changes.
- **The person may write their own wording** for a slide (`heading`/`body`
  set). The editor says which is which ("From your teaching; it changes when
  the teaching changes" / "Your own wording for this presentation") and offers
  *Use the teaching's words again*. Writing one's own wording never changes
  the teaching.
- If the part of the teaching is removed, the slide stays, shows only its own
  wording, and is marked *This part was removed from the teaching*
  (`sourceMissing`).
- **Explicit exports and delivery packages are snapshots**: the document is
  resolved at that moment (teaching text, Scripture text, image bytes) and
  written to a file. A package is deterministic: the same presentation and
  teaching give the same bytes (no export time in it; it carries the
  presentation's and teaching's `updatedAt` instead).

## 5. The one pipeline

```
Teaching ─▶ presentation (db::presentations) ─▶ PresentationDocument ─┬▶ Presenter View / audience screen
                                                                       ├▶ PowerPoint  (presentation::pptx)
                                                                       ├▶ PDF slides, speaker sheet (presentation::pdf)
                                                                       ├▶ Markdown    (presentation::markdown)
                                                                       └▶ delivery package (presentation::package)
```

`presentation::document::build` is the only place that reads the teaching;
**no renderer reads the database or the teaching**. The interface shows the
same document (`presentation_document`). PowerPoint and PDF share one slide
layout (`presentation::layout`: positions and font sizes in points on a
960 × 540 page), so the two show the same slide; the on-screen slide
(`SlideView.tsx`) uses the same proportions (sizes in container-width units:
points ÷ 9.6) and the same theme colours (`resources/presentation/themes.json`,
read by Rust and TypeScript).

**Slide boundaries are decided once, in the document**: a long passage is
split over several slides of about 600 characters, never inside a verse; each
part names its own verses ("John 15:1–4", "John 15:5–8"); the speaker's text
goes with the first part. All outputs use those boundaries.

### The document (schema version 1)

`format: "abiding-word/presentation"`, `schemaVersion: 1`, ids (presentation,
teaching), title, teaching kind, theme, primary passage (canonical parts),
the Bible quoted (id, name, short name, copyright), `updatedAt`s, and:

- `slides[]`: `id` (item id, `#2`… for further parts), `itemId`, `index`,
  `part`/`parts`, `kind`, **`audience`** (heading, body, reference, verses,
  Bible short name, image {assetId, caption, credit, generated}, blank),
  **`speaker`** (manuscript parts {field, text}, notes), `citations`,
  `source`, `sourceMissing`;
- `images[]`: id (the kept material), media type, size, `available`, sha256,
  and — only in a package — the image itself (base64);
- `warnings[]`: `noBible`, `scriptureUnavailable`, `imageUnavailable`,
  `sourceMissing`, `longText` (shown in the editor, per slide).

References are carried as canonical parts; each reader writes them in its
own language (the interface with its book names; exports with the book
names, psalm word and verse separator the interface sends, `ExportLocale`).

## 6. The proposal (deterministic, no AI)

*Make slides from the teaching* (`db::presentations::propose`), in order:

1. title slide (the teaching's title; the main passage as its subtitle);
2. the introduction, if written — a heading in the teaching's own word
   ("Introduction" / "Opening"); its text is the speaker's;
3. the passages of the whole teaching — Scripture slides;
4. the central message, if written — a text slide;
5. for each point or step: a **question** slide for a question step or a
   Bible-study question, an **activity** slide for an activity step,
   otherwise a **heading** slide (its explanation/application/illustration
   become the manuscript); a Scripture step with a passage and an image step
   with an image are shown by that passage/image instead; then the point's
   passages and kept images;
6. the conclusion, if written — a heading; its text is the speaker's.

The person then keeps, leaves out (*Show this slide*), reorders, changes
the kind of, or adds slides (from the parts of the teaching not yet shown, or
their own: heading, text, Scripture, question, activity, quotation, section
break, pause, title). *Start with the title only* is the empty start. No
assistant is involved anywhere in v0.18.

## 7. Kinds of slide

`title`, `section` (section break), `heading`, `text`, `scripture`, `image`,
`quote` (quotation and who said it), `question`, `activity`, `pause` (an empty
audience screen; the speaker keeps their notes). Teaching-focused, not a
general slide designer: no free positioning, fonts or animations.

## 8. Audience versus speaker — the privacy boundary

- What the **audience** may see is one structure (`AudienceSlide`); what the
  **speaker** sees is another (`SpeakerSlide`: manuscript and notes) plus
  citations.
- The audience screen is given `AudienceDocument` (`document.audience()`), a
  **separate type with no speaker, notes or citation fields at all**, so they
  cannot reach it by mistake. The audience window loads only that
  (`presentation_audience`), and what it is told to show (`AudienceState`:
  slide index, pause, a Scripture passage) has no field for speaker text.
- The teaching's own private `notes`, AI provenance (`assistant`), material
  standings, sources and Bible copyright never appear on the audience screen.
  An image's licence credit does (licences ask for it) and a generated image
  is always marked *Generated image*.
- PowerPoint notes pages and Markdown include the manuscript and notes only
  when *Include my manuscript and speaker notes* is ticked (off by default);
  the speaker sheet always has them (it is the speaker's).
- Tests: `speaker_text_never_reaches_the_audience` (Rust: every private
  string absent from the audience JSON), the PowerPoint test (no notes
  without the option), the PDF test (slides PDF without notes; speaker sheet
  with them), and interface tests for the one-window audience view and the
  audience window itself.

## 9. The Presenter View — one view that adapts

One component (`PresenterView.tsx`), never two systems. Its layout follows
the window width (`layoutFor`: < 640 px phone, < 1024 px tablet, else desktop):

| | phone (portrait first) | tablet | desktop |
|---|---|---|---|
| main | speaker sheet: what the audience sees as large text, then manuscript and notes | current slide picture + next slide beside the manuscript and notes | all slides (jump list), current slide, next slide, manuscript and notes |
| moving | big Back / Next at the bottom | Back / Next at the bottom | Back / Next under the slide, the list |
| top bar | slide position · timer · one menu (Scripture, Audience screen, View) · Exit | title left · slide position, timer, clock centred · the four doors as icons right | title left · slide position, timer, clock centred · Scripture, Audience screen, View, Exit right |

**The speaker's material is never moved by a control** (refined after the
first Windows acceptance build, `0.5.0-dev.38`). The top bar has a fixed
height (56 px) and holds only status and four doors: a three-column grid
(`minmax(0,1fr) auto minmax(min-content,1fr)`) keeps the slide position and
timer centred (measured offset 0 px at 820 px and from 1200 px up in all six
languages, with and without the status chip; just above 1024 px the labelled
German and French doors are wide enough that the centre gives way up to 51 px
to the left rather than overlap); the title truncates first, and the status
chip takes at most 65 % of the title's column. The timer's popover follows
the button when the window is resized; on a phone the timer opens as a
full-width bottom sheet. On a
phone the clock is left out of the bar and the title is for screen readers
only, so the bar fits at 360 px in every language. Everything else opens
as a **floating panel** over the view — a side sheet (about 360 px; Scripture
480 px) on a computer or tablet, a small popover for the timer, a bottom sheet
on a phone — and never as a row above the presentation: measured in Chromium
at 1920×1080, 1366×768, 1280×800, 820×1180 and 390×844, the speaker's area
starts at 56 px and keeps its height whether View, Audience screen,
Scripture or the timer is open (shift 0 px), with no horizontal scrolling.
Each panel takes focus (the first control; *Close* in Audience screen, so
nothing is chosen by accident), keeps Tab inside, closes with Escape (also
from its text field, not while an IME is composing), Close or a click beside
it, and gives focus back to its button (on a phone, to the menu). A click
beside a panel never lands on the top bar, which stays usable. Choosing from
the phone menu opens the new sheet with focus inside it.
What the audience sees when it differs from the slide (empty screen, a
passage, the audience window on) is a small chip beside the title with *Back
to the slide* (an icon below desktop width) — in the bar, covering nothing,
not a row. The timer shows only the time (its name says *paused* when paused); a click
opens its popover under it (pause/continue, reset), and page keys still turn
slides while it is open. The clock is plain text. The keys are behind *Keyboard shortcuts* in View.

*View* holds the options: text size (85–175 %), background (Light, Dark,
Warm), timer and clock on/off, keep the screen on, keyboard shortcuts.
Nothing can be edited in the Presenter View. Keys: → ↓ Page Down Space next; ← ↑ Page Up Backspace
back; Home/End; **B** or **.** empties the audience screen; **Esc** leaves
(or closes an open panel, or returns from the one-window audience view).
Focus starts on *Next* and returns to *Start Presenter View* on exit.

## 10. The audience screen

- **Second screen (Tauri multi-window): implemented.** *Audience screen*
  lists the displays (`presentation_screens`, via `available_monitors`);
  choosing *Show on screen 2 (1920 × 1080)* opens a second webview window
  (`label: audience`, URL `index.html?audience=<id>`), moves it to that
  display and makes it full screen (`presentation_audience_open`). The
  presenter tells it what to show through the core (`presentation_audience_show`
  → event `presentation-audience` to that window only); the core keeps the
  last state so a reopened or reloaded window shows the right slide
  (`presentation_audience_state`). Closing the window tells the main window
  (`presentation-audience-closed`); leaving the Presenter View closes it.
  The window's capability (`capabilities/audience.json`) is the
  `audience-window` set and event listening only: no dialogs, updater or
  links. Since v0.18.3 the app's own commands are limited per window too
  (an app command manifest): the audience page may call only
  `presentation_audience`, `presentation_audience_state`,
  `presentation_audience_key`, `presentation_layout` and `presentation_image`
  ([`correctness-hardening-v0.18.3.md`](correctness-hardening-v0.18.3.md) §3).
- The audience window opens **without taking focus** and focus is given back
  to the main window, so the keyboard and a clicker stay with the Presenter
  View. Keys pressed while the audience window has focus are handed to the
  Presenter View (`presentation_audience_key`, an allow-list of navigation
  keys); Esc there closes the audience screen. Closing the main window closes
  the audience window. A window left from another presentation is pointed at
  the new one.
- **One window:** *Show in this window* fills this window with the audience
  slide (for a mirrored or shared screen, and where no second window can be
  opened, e.g. the web harness). The controls stay invisible until the
  pointer or keyboard is on them; keys still move the slides; Esc returns.
- Not faked: where no second display exists the panel says so and offers a
  new window or this window.

## 11. Scripture without losing the place

*Scripture* in the Presenter View looks up any passage (typed, or one of the
presentation's passages as a button) in the presentation's Bible, **privately**.
*Show to the audience* puts it on the audience screen over the slide
(`AudienceState.scripture`: label, Bible, verses); *Stop showing it* or
*Back to the slide* removes it; moving to another slide removes it too. The
place in the presentation never changes.

## 12. Timer, clock, keeping the screen on

The timer starts with the Presenter View and can be paused and reset; the
clock shows the time of day in the interface language. **Keep the screen on**
uses the Screen Wake Lock API where the webview offers it (WebView2 on
Windows does) and asks again when the window becomes visible; where it is
not offered (jsdom; some WebKit versions) the checkbox is disabled and the
view says so: *This system does not let the app keep the screen on…*.
Not mandatory.

## 13. Exports

Since v0.18.6 the same export dialog is also reached from the teaching's
**Materials** menu (*Save the presentation as a file…*) once slides exist; the
editor's own export button is unchanged ([`study-flow-materials-v0.18.6.md`](study-flow-materials-v0.18.6.md)).

All exports: the native **save dialog** (`dialog:allow-save`; it asks before
replacing a file), a file name from the title ("Remain in the vine.pptx",
"… – speaker sheet.pdf"), the extension added when missing, written to a
temporary file and renamed only when complete, made on this computer with no
network, and the teaching is not changed.

- **PowerPoint (.pptx)** — Office Open XML written directly with the `zip`
  crate (`presentation/pptx.rs`), no external program or Python: one master,
  one blank layout, a theme with the presentation's colours (fonts: Arial,
  Malgun Gothic for Hangul), one slide per document slide with text boxes and
  pictures at the shared layout's positions and sizes, picture alt text from
  the caption, optional notes pages (notes master + notes slides). Files are
  written in a fixed order with fixed dates: the same presentation gives the
  same file. Images: PNG, JPEG, GIF embedded; WebP shown as a framed
  placeholder.
  *Validation here:* every XML part well-formed (quick-xml) and expected parts
  present (Rust test); opened and re-saved with python-pptx (all slides,
  texts, picture and notes read back). LibreOffice could not be started in
  this container (it fails on any file), and PowerPoint is not available
  here: **opening in PowerPoint is part of the Windows acceptance checklist.**
- **PDF slides** — one 960 × 540 page per slide, same layout as PowerPoint,
  background in the theme colour, images (JPEG as is; PNG decoded with
  transparency as a soft mask).
- **Speaker sheet (PDF for a phone)** — a 360 × 640 pt page per slide (more
  when needed), large type (17 pt text, 22 pt headings), *Slide n / N*, what
  the audience sees with an accent bar, then the manuscript and notes, and
  the sources when chosen.
- **Overwriting** — the save dialog asks before replacing a file. When the
  name typed has no extension, the extension is added and, if a file with that
  name exists, the export is refused with *A file named … already exists*
  (the dialog never saw that name). A presentation with no slides shown cannot
  be exported as PowerPoint or PDF.
- **Fonts in PDFs** — the computer's own TrueType fonts, only where their
  licence allows embedding (OS/2 `fsType`): Windows Segoe UI, Arial, Malgun
  Gothic, Nirmala; macOS Arial, Arial Unicode, Apple Gothic; Linux DejaVu Sans,
  Liberation Sans, Nanum Gothic, WenQuanYi Zen Hei, FreeSans. Fonts whose
  licence forbids embedding or subsetting, and fonts whose tables cannot be
  read, are left out. Each character
  takes the first font that has it. Fonts are embedded as **subsets** (only
  the glyphs used; glyph numbers kept, composite glyphs followed) as
  CID-keyed TrueType with Identity-H and a ToUnicode map, so text can be
  searched and copied (Korean included). Without any usable font the PDF
  uses its built-in Helvetica for Latin-1 and `?` otherwise (tested).
  CFF-based fonts (`.otf`) are not used.
- **Markdown (.md)** — title, main passage, a section per slide (headings,
  Scripture as a quotation with verse numbers, question in bold, image as
  caption with credit), speaker text and sources only when asked for.
- **Delivery package (.json)** — §14.

## 14. The delivery package and preparing for mobile

A delivery package is the document (§5) with every available image embedded
(base64, with media type, size and sha256), pretty-printed JSON with a
trailing newline. It is **self-contained**: everything needed to present —
slide order and boundaries, audience and speaker text, Scripture text and
Bible name, images, credits, citations, theme — without the desktop database
or any network. `package::from_json` reads one back and refuses a package
from a newer schema (`schemaVersion` > 1) rather than misreading it. No
absolute paths of this computer are in it (tested).

A later mobile reader needs only this file and the theme colours: it shows
`audience` on the screen it projects to and `speaker` on the phone, using
`slides[].index`. The phone layout of the Presenter View already is that
reader's design.

## 15. Images and offline delivery

- Generated images the person kept are files in the data folder: always
  available offline.
- Found images (Wikimedia Commons) were kept as addresses. In the editor an
  image slide without a local copy says *This image is not on this computer
  yet* and offers **Save a copy** (only on that click; only from
  `upload.wikimedia.org`; a 1600-px Commons preview first, then the small
  preview — never the full original file, which can be very large; at most
  25 MB; must really be an image). The copy is
  saved under `sources/presentation-images/<sha256 of the address>`; the
  teaching is not changed.
- An image without a local copy is a framed placeholder (*Image not available
  on this computer*) in every output, and the export tells how many.
- During delivery nothing is fetched: no assistant, no web images, no online
  Scripture (Bible text comes from the installed Bible), no web sources.

## 16. Themes, accessibility, readability

- Three backgrounds only — **Light, Dark, Warm** — for the slides and,
  separately, for the Presenter View. All text colours have at least 7:1
  contrast on their background; muted text at least 7:1 as well.
- Audience text is never below 22 pt on a 960-pt slide (16 pt only for an
  image's licence credit); long texts are set smaller down to that minimum
  and the editor warns (*A lot of text for one slide*).
- Keyboard everywhere; targets at least 44 px; screen-reader names for every
  control and slide ("Slide 5: Stay connected", "Current slide, Slide 1 of 6");
  slide position in a live region; no colour-only status (warnings are
  words); no animation; focus is never lost (start ↔ exit, reorder, add,
  remove, Back to the teaching).

## 17. Languages and terminology

All interface text is in the new `presentation` area of the six locale files.
One natural term per language for the single presenter mode:

| English | Deutsch | 한국어 | Français | Español | Português |
|---|---|---|---|---|---|
| Presentation | Präsentation | 프레젠테이션 | Présentation | Presentación | Apresentação |
| Presenter View | Referentenansicht | 발표자 보기 | Mode présentateur | Vista del presentador | Modo apresentador |
| Audience screen | Bildschirm für Zuhörer | 청중 화면 | Écran de l’auditoire | Pantalla de la audiencia | Tela do público |
| Speaker notes | Notizen (für dich) | 발표자 메모 | Notes du présentateur | Notas del presentador | Notas do apresentador |
| Speaker sheet | Sprechzettel | 발표자용 원고 | Feuillet de l’orateur | Hoja del orador | Folha do orador |
| Delivery package | Vortragspaket | 발표 꾸러미 | Paquet de présentation | Paquete de presentación | Pacote de apresentação |
| Slide | Folie | 슬라이드 | Diapositive | Diapositiva | Slide |

German uses *du* throughout and *Bibellehre* for the teaching.

## 18. Code map

| Part | Where |
|---|---|
| migration | `src-tauri/migrations/0010_presentations.sql` |
| domain types | `src-tauri/src/domain/presentation.rs` |
| repository, proposal | `src-tauri/src/db/presentations.rs` |
| document, audience projection | `src-tauri/src/presentation/document.rs` |
| layout, text, fonts, images | `src-tauri/src/presentation/{layout,text,fonts,images}.rs` |
| renderers | `src-tauri/src/presentation/{pptx,pdf,markdown,package}.rs` |
| commands, audience window | `src-tauri/src/commands/presentations.rs` |
| interface | `src/features/presentation/*`, entry in `src/features/teaching/TeachingView.tsx`, audience page in `src/main.tsx` |

## 19. Tests

- Rust `tests/presentations.rs` (12): proposal order and determinism; Bible
  Study questions and lesson steps; live links and own wording without
  changing the teaching; add / reorder / leave out / delete and refusals;
  removed parts and removed teachings; Scripture from an installed Bible and
  honest warnings; the privacy boundary; the package's determinism,
  self-containment and schema refusal; Markdown; PowerPoint parts, well-formed
  XML, determinism and notes only when asked; PDF page counts and extracted
  text (Hangul where a font exists); exports without any system font.
- Rust `tests/migration_v10.rs` (1); unit tests in `presentation/*` (image
  headers, verse splitting, references in other languages, font subsetting,
  composite glyphs, text wrapping with Hangul).
- Interface `tests/ui/presentation.test.tsx` (15) and
  `tests/unit/presentation-labels.test.ts` (4): proposal; live/own wording;
  notes; leave out / move / add; the Presenter View at phone, tablet and
  desktop widths with keys and focus; text size, three backgrounds and the
  wake-lock limitation; one-window audience view without notes; the second
  screen following the presenter with pause and Scripture; the audience
  window given audience content only; exports through the save dialog,
  cancelled saves; German wording; export words in German and Korean; a
  clicker on the audience screen, Space on buttons, Tab kept inside, focus
  after moving to the first place; splitting with Hangul. The layout
  refinement adds 10 (27 in the file): opening View, Audience screen, Scripture
  or the timer at 1920, 1366, 1280 and 820 px inserts nothing into the layout,
  keeps the same `main`, and moves focus in and back; the top bar's buttons
  and its left / centre / right columns; the timer popover and the paused
  label; keys help behind its toggle; Tab trapped in a panel; the phone menu,
  its bottom sheets and focus inside each; a click beside a panel; Audience
  screen starting on *Close* and focus after opening and closing screen 2.

## 20. Deferred, on purpose

- A mobile app reading delivery packages (the package and phone layout are
  ready for it); remote control of the desktop Presenter View from a phone
  (its command boundary is defined, §23).
- Not copied from other presentation software, on purpose (§23): audience
  Q&A, live captions, recording/narration, a rehearsal coach, animations and
  transitions, kiosk mode, a free-form designer, slide masters, collaborative
  live editing, a shortcut editor.
- Importing a delivery package back into the desktop app.
- PowerPoint export of WebP images and PDF export of GIF/WebP images (they
  are framed placeholders, counted in the export's notice); CFF/OpenType fonts
  in PDFs.
- Limiting the app's commands per window (an app command manifest), so the
  audience window could call only what it uses.
- Drag-and-drop reordering (buttons and keyboard are there); per-slide
  backgrounds; transitions (deliberately none).
- Showing a presentation's slides in Study search.

## 21. Independent review and fixes

An independent review of the whole diff against `main` checked the single
pipeline, privacy boundary, determinism, OOXML/PDF structure, font
subsetting, migration and accessibility; it confirmed those and found:

| Finding | Fix |
|---|---|
| Opening the audience window took keyboard focus; a clicker then did nothing and Esc could not close it | window opens unfocused, focus returns to the main window; keys on the audience screen are handed to the Presenter View; Esc there closes it |
| Core error messages for presentations were not translated | `errors.presentation.*` in all six languages |
| A typed name without extension could replace an existing file unasked | refused when the added-extension name exists |
| Korean passages could overflow a slide; a long passage shown from *Scripture* was never split | Hangul/CJK count double when splitting (core and interface); a shown passage goes a slide's worth at a time (*Show the next part*) |
| Closing the main window left the audience window | it is closed with the main window |
| Space on a focused button turned the page | Space/Enter press the focused control |
| Tab could leave the Presenter View | Tab stays inside it |
| Moving a slide to the first/last place lost focus | focus goes to the other arrow (or the slide) |
| Fonts forbidding subsetting were subset | such fonts are left out |
| Nits: missing PDF image object, long words after a line break, empty exports, reused audience window, missed first move, refused saves treated as saved, GIF count, WinAnsi punctuation, unreadable fonts, wake-lock release, focus after panels, large downloads, temp-file names, 13-px warnings, timer label, German/French wording | all fixed (see the commit) |

A second independent review, of the Presenter View layout refinement (diff
from `ac4e027`), found and the branch fixed: focus fell to the page when a
phone-menu choice opened its sheet (blocker; the panel now remounts per
choice); the floating status note covered the speaker's material (now a chip
in the bar); the bar could overflow at 390 px in French and Spanish (the
position truncates, no clock on a phone); Audience screen focused *In this
window* first (now *Close*); Escape during IME composition closed panels;
focus after closing the audience window; a click beside a panel could land on
the bar; no *paused* label; the timer popover was not under the timer; page
keys stopped while the timer popover was open; and missing tests for each.
A last review of those fixes found the phone timer sheet offset by the
popover's anchor (fixed: anchoring applies to the popover only), a popover
position that did not follow a resize, a ref that re-rendered the view every
tick, and a long Scripture chip hiding the title; all fixed, with tests for
the phone timer sheet, a door clicked while a panel is open, and Escape
during IME composition.

Not changed: per-window command limits (§10, §20); the editor reading and
hashing each image on refresh (small, local files; kept simple).

## 22. Windows acceptance checklist

1. Open a Bible Teaching → *Presentation* → *Make slides from the teaching*:
   the slides follow the teaching's order; nothing in the teaching changes.
2. Change a point's title in the teaching → the slide's heading follows; write
   your own heading → the teaching keeps its title; *Use the teaching's words
   again* works.
3. Add speaker notes; leave a slide out; move one; add a Pause and a
   Scripture slide (e.g. Romans 8:1).
4. *Start Presenter View*: keys (→, ←, Page Down/Up, B, Esc), timer, clock,
   text size, Light/Dark/Warm; resize the window narrow (phone sheet) and
   medium (tablet).
5. With a second display (or projector): *Audience screen* → *Show on screen
   2*: the audience window fills that display, the keyboard stays in the
   Presenter View, a clicker moves the slides, B empties it, a passage from
   *Scripture* is shown and removed, notes never appear; Exit (or closing the
   app) closes it. Without one: *Show in this window*.
6. *Keep the screen on*: the screen does not dim during a long pause (or the
   limitation is shown).
7. *Export…* → PowerPoint with and without notes → open in **PowerPoint**
   (no repair message), check slides, Scripture, image, notes pages.
8. PDF slides and the speaker sheet (open the sheet on a phone); Korean or
   German text renders and can be selected.
9. Markdown and delivery package open in a text editor; the package has the
   images embedded.
10. A found image without a copy: *Save a copy* (online), then present and
    export offline (Wi-Fi off).
11. Upgrade from v0.17 data: a `pre-migration/abiding-word-v9-…` backup is
    made, everything is there.
12. *Overview* (or **O**) → choose a slide: the Presenter View goes there and
    the audience follows. Type **3**, **Enter**: slide 3.
13. With the audience screen on: *Blank audience screen* (or **B**) → the
    projector goes blank, you keep your notes and place; again → the same
    slide. The *Pointer* and *Highlighter* over the current slide show on the
    projector; *Clear marks*; a new slide starts clean; Esc puts the tool away.
14. Settings → *Target time* 30 min → the timer says "· 30 min left" quietly;
    let it run past (or set 5 min) to see *nearly there* and *over*.
15. View → *Layout*: *Larger notes*, *Larger slides*; exit and present again:
    the layout is remembered. A phone-sized window always shows the speaker
    sheet.
16. With the audience screen on a projector: close its window by hand, then
    unplug the projector: the Presenter View stays, says *Audience screen
    disconnected*, and *Show again* brings it back (or lets you choose where).

## 23. Presentation Pareto polish

A focused pass that takes the few presenter features that matter most in
real talks (from PowerPoint's Presenter View, Keynote's Presenter Display,
Google Slides, Pitch, Gamma and ProPresenter-style stage workflows) and
leaves the rest. The test for each: *would a pastor teaching from the Bible
use it in a real talk, without explanation?*

### What was added

| Feature | How it works | Why |
|---|---|---|
| **Overview** | A door in the top bar (☰ on a phone) and **O**: every slide as a small picture with its number and name, in a large floating sheet (a list on a phone). The current slide is marked and focused; choosing one goes there and closes the sheet. | Finding your place during a real talk, especially on a tablet or phone where the slide list does not fit. |
| **Blank audience screen** | A button beside Back/Next while the audience screen is on (named on computer and tablet, an icon on a phone), and **B** (or **.**). The audience screen goes blank; the speaker keeps their material and place; the same action brings back exactly the same slide. Moving on ends it. | The most used "live" control in every presenter tool: draw attention to the speaker or a story. |
| **Pointer and highlighter** | Three small buttons over the current slide while the audience screen is on: *Pointer* (a soft red spot), *Highlighter* (one yellow, translucent pen), *Clear marks*. Positions travel as a share of the slide (0–1), at most once a frame. Marks clear with the next slide or a passage; **Esc** puts the tool away. | Pointing at a word in a verse is the one annotation teachers use; shapes, text boxes and colours are not. |
| **Target time** | The timer waits until the talk begins (the first move or the audience screen shown). *Target time* in the presentation's settings (none, 5–120 min); saved with the presentation (migration 0011, `presentations.target_minutes`). The timer adds "· 18 min left" in muted text; the last tenth (at least two minutes) and time over use the accent colour ("3 min over"). On a phone, a small dot only near the end or after it. | One quiet number instead of pacing analytics; nothing blinks or warns. |
| **Layouts** | View → *Layout*: *Slides and notes* (default: all slides, current, next, notes), *Larger notes*, *Larger slides*, with a small picture of each. Remembered on this computer. A phone always shows the speaker sheet and offers no choice. | Three presets instead of dragging panels. |
| **Bible passage → audience** | The *Scripture* door is now *Bible passage*. Looked up privately, *Show to audience*, then *Return to slide* (in the panel and in the bar) brings back the same slide. The current slide preview shows what the audience sees (the passage, the marks). Nothing in the presentation changes. | Abiding Word's own strength, made plainer. |
| **Keys and clickers** | → ↓ Page Down Space: next; ← ↑ Page Up: back; Home/End; **B** / **.** blank; **O** Overview; a number then **Enter** goes to that slide ("Go to slide 12…" shows while typing; forgotten after four seconds); **Esc** steps back one thing at a time: a typed number, a panel, the pointer or highlighter, the one-window view, then leaving — with the audience screen on, leaving takes a second Esc. A clicker on the audience screen sends the same keys (digits and O included). | Clickers send Page Up/Down or arrows: they work without setup. No shortcut editor. |
| **Audience screen recovery** | If the audience window closes without the speaker asking, or its screen disappears (checked every three seconds while it is on; the window is closed so it cannot cover the speaker's screen), the Presenter View stays where it is and the bar says *Audience screen disconnected* with *Show again* — on the same screen when it is back, otherwise the *Audience screen* panel to choose. Closing it on purpose is not reported. | A projector cable is pulled more often than any feature is needed. |
| **Door labels that fit** | The top bar measures itself: the doors carry their names when they fit beside the slide number and timer (the centre may give way by up to 80 px for them), otherwise they are icons (named on hover and for screen readers). Measured in Chromium: names from 1280 px in English and Korean, 1366 px in Portuguese, 1440 px in German and Spanish, 1920 px in French; the centre at most 68 px off when names are shown and exact otherwise; no horizontal overflow from 360 px up. | Five doors with long French or German names do not fit a 1366-px laptop. |

### Live state versus saved presentation

Everything that happens while presenting lives in one plain object,
`DeliveryState` (`src/features/presentation/delivery.ts`): the current
slide, a blank audience screen, a passage shown, the pointer and highlighter
marks, the timer. It is never written to the database, the package or an
export. Saved with the presentation: order, included slides, wording,
speaker notes, background, Bible and the **target time**. The layout, text
size, background of the Presenter View, timer/clock visibility and keep-awake
are this computer's preferences (local storage), not presentation data.

The audience screen receives `AudienceState` — place, blank, passage and
`marks` (`LiveMarks`: an optional pointer and at most 50 strokes of at most
500 points, clamped to 0–1 by the core, `LiveMarks::bounded`). It still has
no field for speaker text.

### The remote-control boundary

`PresenterCommand` is the boundary a future phone remote will use:

```text
next · previous · first · last · goTo(index) · toggleBlank ·
showScripture(passage) · returnToSlide · timerStart/timerPause/timerReset(at) ·
pointer(at | null) · penDown(at) · penMove(at) · clearMarks
```

`deliver(state, command)` applies one command and returns a new state; it
knows nothing of React or the screen. The Presenter View's buttons, its keys
(`commandForKey`), a clicker on the audience screen and the tests all send
these commands. A remote will send the same commands as plain JSON (a test
replays such a sequence); the transport (local network pairing) is not built.

### Deliberately not copied

Audience Q&A, live captions, recording and narration, a rehearsal coach,
animations and transitions, a kiosk mode, a free-form slide designer, slide
masters, collaborative live editing, a shortcut editor, laser-pointer colours,
shapes and text boxes, a "confidence monitor" configuration, presenter-view
panel dragging, pacing analytics. They are recorded in
[`product-backlog.md`](product-backlog.md), not in the interface.

### Wording

Labels were read as a pastor who mainly uses Word and a browser would read
them: *Bible passage* (was *Scripture*), *Show to audience*, *Return to slide*
(was *Back to the slide* / *Stop showing it*), *Blank audience screen* (was
*Empty the audience screen*, which also lived in the Audience panel; now one
place), *Overview*, *Layout*, *Target time*, *Audience screen disconnected*,
*Show again*. German keeps *du* and its single term *Referentenansicht*
(*Bild für Zuhörer ausblenden*, *Übersicht*, *Zielzeit*); every language keeps
its one presenter term.

### Tests

- `tests/unit/presentation-delivery.test.ts` (10): commands move within the
  ends; blank keeps and restores the exact slide; a passage and *Return to
  slide*; marks clamp, clear and end with the slide; the timer; the state is
  never changed in place; keys and clickers; a remote's JSON command sequence;
  time guidance (none, on time, nearly there, over).
- `tests/ui/presentation.test.tsx` (+14, 41 in the file, including the review fixes below): Overview over the
  view, focus on the current slide, jumping with the audience following and
  the presentation unchanged, **O**; blank only on the audience screen and the
  same slide back, nothing private in what reaches it; pointer and
  highlighter reach the audience, clear, end with the slide, Esc puts them
  away without leaving, nothing saved; target time in the timer and its
  popover; choosing and saving the target time; layouts remembered, a phone
  always the speaker sheet; Bible passage shown and *Return to slide*, the
  presentation unchanged; Page Down/Up, arrows, Space, Home/End, a number and
  Enter, Esc forgetting a number; an audience window closed by accident and a
  lost projector with *Show again*; a deliberate close not reported. The
  layout test now opens Overview too, at four widths.
- Rust: `tests/migration_v11.rs` (1, v10 → v11 with backup), in
  `tests/presentations.rs` a target time kept, refused above ten hours and
  removed, and live marks kept small and on the slide.

### Independent review of the whole experience, and fixes

A review of the complete Presenter View (compared, as the brief asked, with
PowerPoint, Keynote, Google Slides, Pitch, Gamma and ProPresenter, without
adding anything for its own sake) found no blockers and these real problems,
all fixed with regression tests:

| Finding | Fix |
|---|---|
| A number and **Enter** pressed *Next* (which has the keyboard when the view opens) instead of going to the slide | Enter after a number is handled first, whatever has the keyboard |
| After clicking *Blank* or a slide, **Space** pressed that button again instead of moving on | Space/Enter on a button that was *clicked* turn the page and release the button; on a button reached with Tab they still press it (checked in Chromium too) |
| A clicker's Page Down did nothing while a panel was open (e.g. right after *Show to audience*) | Page Down/Up, ←/→, B and . work over panels (not while typing) |
| After a lost projector the spoken status said "closed"; a missed closing event could silence the next accidental close | the screen check no longer marks the close as wanted; *Show again* resets it; the test API now reports closes as the app does |
| Fast changes (pen, a double click) could reach the audience screen out of order | every change carries a sequence number; the core keeps only newer ones (`AudienceState::replaces`, one lock) and the audience window drops late ones |
| The pointer could stay on the audience screen after leaving the slide; a cancelled touch kept drawing | leaving cancels the waiting frame; cancel and lost capture end a stroke |
| The highlighter stayed active without its buttons after a disconnect | pointer and highlighter work only while the audience screen is on |
| The timer started when the view opened (during the songs), so "min over" misled | it waits ("starts when you move on") and starts with the first move or when the audience screen is first shown, or by *Start timer* |
| One **Esc** (also a clicker's) ended the presentation and the projector mid-sermon | with the audience screen on, the first Esc asks ("Press Esc again to stop presenting"), the second leaves |
| Nits: the audience window flashed slide 1 before knowing what to show; modifier keys were forwarded; pen data was large; the doors could change during a typed number; Esc put the pen away before closing a panel over it; O opened an invisible Overview in the one-window view; the tablet Blank button had no visible name; "window" in the German and Korean keys help; the target-time hint inside its label; a loose privacy assertion | background only until the first state; Ctrl/Meta keys ignored; at most 50 strokes of 500 points, points closer than 0.4 % dropped; hints do not re-measure the bar; panels close first; O ignored there; the name is shown; "Bereich"/"패널"; hint below; the exact list of fields reaching the audience is asserted |
