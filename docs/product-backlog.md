# Abiding Word — Product backlog and principles

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[What's ready, and what's coming](../README.md#whats-ready-and-whats-coming)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

> **BACKLOG / FUTURE.** Nothing in this document is built, scheduled or
> promised. It records product-owner decisions so that today's code does not
> make them harder later. The frozen [`architecture.md`](architecture.md) and
> [`concept.md`](concept.md) remain the references for what the product is.

## 0. Guiding principle: the software should disappear

Every item below is judged against the product principle in
[`concept.md`](concept.md) (§3a): the user should be thinking about Scripture,
not about Abiding Word. Simple UI over expressive internals; sensible defaults;
natural input; advanced options hidden until useful.

## Future UX and input items

### Simplify Study creation (UX) — shipped in v0.6, refined in v0.10

Done in v0.6 ([study-workspace-ux-v0.6.md](study-workspace-ux-v0.6.md)): "What would
you like to study?", with approaches (Passage study, Word study, Topic, Teaching
preparation, My template) and a derived title; type and template are one choice.
v0.10 ([study-workspace-refinement-v0.10.md](study-workspace-refinement-v0.10.md))
removes the last prerequisite: a project is made automatically ("My studies") when
needed. The data concepts remain separate internally: simple UI over expressive
internals.

### Multilingual, natural Bible references (input)

The reference parser should become broadly multilingual and tolerant of
normal local notation, so that nobody has to learn Abiding Word syntax.

- Languages: at minimum English, German, Korean, French, Spanish, Portuguese;
  also common Koine Greek and Biblical Hebrew book names and abbreviations.
- Natural forms, e.g. `John 3:16`, `John 3.16`, `John 3,16`, `Joh 3,16`,
  `Johannes 3,16`, `Jn 3:16`, `Jean 3,16`, `Juan 3:16`, `João 3:16`,
  `요 3:16`, `요한복음 3장 16절`.
- Tolerate colon, comma, period, semicolon, spaces, hyphen and en-dash
  ranges, chapter/verse words where common, and standard local abbreviations.
- Pipeline: natural input → locale/book-alias recognition → punctuation and
  reference normalisation → deterministic parse → canonical `ScriptureRef`.
  No AI.
- Reusable in Go to passage, study creation, Scripture navigation, findings,
  source passage detection, imports and future AI tools.

**Status (v0.9):** source-language-aware detection is implemented for English,
German, Korean, French, Spanish and Portuguese (see
[`passage-aware-sources-v0.9.md`](passage-aware-sources-v0.9.md)).

**Status (v0.18.2–v0.18.3):** typed references are read in 100 languages by
one shared resolver, decided by the Bible's language, then the interface
language, then the common reading, otherwise asking; verses are checked
against the canon; imported Bibles carry a language
([`reference-language-packs.md`](reference-language-packs.md),
[`correctness-hardening-v0.18.3.md`](correctness-hardening-v0.18.3.md)).
Remaining: Biblical Greek and Hebrew book names beyond the generated packs,
looser natural phrasing, verse-count checks in running text (they would need
per-Bible versification), and language metadata from other download
formats.

### Passage-aware sources: what remains after the first v0.9 checkpoint

Built: section and inherited links from EPUB, Word and Markdown headings;
ranking and grouping in the Sources pane; deterministic rebuild for existing
libraries. Backlog: Greek/Hebrew detection; a way to confirm or add a
passage link by hand (the `manual` origin exists, nothing creates it);
cross-versification mapping; heading references that are not at the heading's
start or end being treated more cautiously; same-book matches, if they prove
useful; PDF sections if the importer ever finds trustworthy headings.

### Scripture links inside Library sources — shipped in v0.11

See [`scripture-links-v0.11.md`](scripture-links-v0.11.md): references in the
Reading view and in formatted EPUB / Word pages offer **Open in Bible**;
Scripture has Back / Forward and **Back to {main passage}**; the Study is never
changed. Scripture links in the PDF Original view are built in v0.13
(accepted with v0.13; see [`library-reading-v0.13.md`](library-reading-v0.13.md)):
placed with PDF.js's own text layer, never guessed. Still open: references in
right-to-left or vertical PDF text; references split across formatting in
formatted pages; further actions (Add as related passage, Copy reference).

### Concordance — surface forms shipped in v0.12 (accepted); lemma and morphology open

See [`concordance-v0.12.md`](concordance-v0.12.md): Word and Phrase occurrences
in one Bible, by book, with per-script normalisation (Latin accents kept,
Greek accents and Hebrew points ignored), opened in Scripture with Back, and
**Find occurrences** from a word study. **Not built:** lemma or morphology
search, Strong's or other lexical identifiers, lexicons, interlinear, OSIS /
USX import, comparison across translations. These need an importer that keeps
token data (the USFM importer drops `\w` attributes today).

### From the user's own materials to templates

The user may bring their own Bible-study, sermon or teaching materials.
Abiding Word could help derive **reusable study templates** from structures
that recur in them: section headings, question sequences, an
observation → interpretation → application flow, teaching outlines,
reflection prompts, audience/application sections.

- Templates stay user-owned.
- Extraction is human-reviewed: suggest a template, let the user confirm and
  edit it.
- The original material is never silently restructured or overwritten, and
  stays separate from the resulting template.

### Study workspace UX simplification — main work shipped in v0.6; v0.10 refines the rest

The principle stands: show only what the user needs at the current moment, so that
the person is studying Scripture, not operating the Study data model.

**Shipped in v0.6:** title edited in place; type and template chosen together at
creation; status, purpose, template and passage management moved into Study details;
related passages as a quiet action; related studies, findings and Contents only when
present; one Add action; findings as notes in the flow.

**Refined in v0.10:** no project needed before a first study; the passage not
repeated when the title is the passage; the type out of the header; Details grouped;
one Add that also covers text blocks; the Note block renamed Remark; faster note
capture; findings shown in their sections; visible edit and block controls; 44px
targets and pane-aware layout; a calmer study list and relation picker.

**Still open:** an Add reachable from the middle of a long study; project
organisation for people with many projects; a real-display dark-mode review.

### Document annotations — highlights, notes and bookmarks built in v0.14; ink open

**Built in v0.14** (see [`source-annotations-v0.14.md`](source-annotations-v0.14.md)):
highlights, notes (on words or a place) and bookmarks in library sources, kept
apart from the structured Scripture annotations of v0.5 and anchored in the
stored text (never in a view). They are drawn in Reading, on Original PDF
pages and in formatted EPUB/DOCX; made in Reading and on PDF pages; found
again (or kept as unresolved, never moved) when the stored text changes; and
listed in **Marks** with the Bible's marks (*Bible and sources / Bible only /
Sources only*) and in each reader beside Contents. The original file is never
touched.

| | Structured Scripture annotations (v0.5) | Source annotations (v0.14) |
|---|---|---|
| Tied to | canonical verse / phrase | one source document |
| Position | canonical reference, translation-aware | stored text (segments, offsets, quote and context); page and place as fallbacks |
| Ink | no | not yet (below) |
| Works without structured Scripture | no | yes |

**Still open:**

- **v0.14.x:** making marks directly in the formatted EPUB/DOCX Original (selection inside its shadow root, once checked on Windows); bookmark and note-here buttons in the formatted Original; a selection across two PDF pages.
- **Ink:** freehand pen/stylus markup (underline and shapes possibly later), in its own storage for strokes; the annotation model already leaves room (positioning in the small `anchor` JSON). Stylus support should consider Windows pen, touch devices, tablets and pen-enabled laptops, a smooth handwriting experience, and pressure/stroke data only if needed. Ink would appear in Marks with the rest.
- **With studies:** built in v0.15 (see [`sources-to-study-v0.15.md`](sources-to-study-v0.15.md)): *Add to Study* from selected words, highlights and notes, with the quote, place and source kept as the finding's citation; *Copy quotation with citation* in one plain format. Never automatic. Still open: *show the original mark* from a finding; offering a quote's Scripture references as related passages (explicitly, never automatically); citation styles and bibliography, only when needed.
- **Restoring marks after a re-import** of the same file (the content hash and quote-based recovery make it possible).
- **PDF Bibles:** linked to canonical Scripture **only if reliable verse mapping exists**. Page annotations never automatically correspond to canonical Scripture and no verse mapping is invented.

## 1. Detachable panes (multi-monitor workspace)

The workspace has three primary panes: **Scripture | Study | Sources**. Each
should eventually be detachable into its own native window, in any grouping:

```
[ Scripture | Study | Sources ]          all together
[ Scripture | Study ]   [ Sources ]      one detached
[ Scripture ]   [ Study | Sources ]
[ Scripture ]   [ Study ]   [ Sources ]  all separate
```

Purpose: multiple monitors and large study setups.

**Principle: detached windows are views into the same workspace, not separate
workspaces.** They share the active project and study, Scripture passage,
translation, the source being read and its page/location, annotations,
navigation events and relevant selection/context. An action in one window
updates the others.

Likely needs: Tauri multi-window, application/session state that lives outside
one React tree, inter-window event/state synchronisation, restoring window
placement, and awareness of monitors being connected or removed.

Until then: avoid making pane components depend on there being exactly one
window or one React tree where that is easy to avoid.

*v0.18 note:* the presentation's audience screen is the first second window
(label `audience`, its own minimal capability, state relayed by the core with
events and kept in the core for a reopened window). Detachable panes can
reuse that pattern.

## 2. AI: the human is the primary author

AI in Abiding Word is an **assistant to human study and teaching.** The user
remains the primary reader, interpreter, theologian, writer, teacher, sermon
author and Bible-study author.

- There is no intended workflow such as "generate a complete sermon", "write my
  whole study" or "create the whole lesson", and no prominent one-click
  whole-sermon or whole-study generation.
- AI may help with bounded tasks: suggesting questions, probing a passage,
  finding gaps in reasoning, flagging unclear wording, clarifying a difficult
  paragraph, suggesting structure or communication improvements, suggesting
  passages to investigate, comparing interpretations, summarising a source
  being read (with provenance), explaining terminology, grammar and style,
  improving what the user has already drafted, challenging assumptions,
  listing unresolved issues, adapting wording for an audience, and
  translation or language help.
- Suggestions stay suggestions: **human thinks and writes → AI assists,
  challenges, clarifies → human decides, revises and owns.**
- This is a product-design stance, not a restriction on users: nothing stops a
  person from using AI heavily on their own. Abiding Word itself just does not
  position AI as the author.

It shapes command names, buttons, prompts, output size, provenance, UI
wording and the review workflow.

**Built in v0.16** (see [`teaching-preparation-v0.16.md`](teaching-preparation-v0.16.md)):
teaching preparations written by the person, and an optional, provider-neutral
assistant beside each part of a teaching (wording, comments, ideas, real
stories through search, images), which never changes the person's text
without an explicit choice and lists what it will see before anything is sent.

**Refined after Windows testing** (§17 of the v0.16 record): calmer Settings,
more provider presets with plain key help, a two-level Help menu with a
free-text request answered only as comments, visible progress for long
operations, and a Teaching view where the writing comes first.

**Still open:** the assistant in the Study itself (findings, sections) and in
the Library (summarising a source with provenance); research modes beyond one
teaching ("my library only", "compare these three commentaries"); a record of
accepted assistant wording; a persistent Linux key store; search through an AI
service's own search tool; copying teaching preparations with a study and
finding them in study search.

### Presentation — foundation built in v0.18

Presentation is an **output of a teaching**, not a third view beside Bible
Study and Bible Teaching. **Built in v0.18** (see
[`presentation-delivery-v0.18.md`](presentation-delivery-v0.18.md)): both
paths on one pipeline — **A.** PowerPoint, PDF slides, a phone speaker sheet,
Markdown and a delivery package; **B.** presenting directly with one
responsive Presenter View and an audience screen in a second window (or this
window), Scripture shown on request, notes never shown to the audience.

Still open:

- a **mobile reader** for delivery packages (the package and the phone layout
  of the Presenter View are its base), and controlling the desktop Presenter
  View from a phone;
- importing a delivery package on another desktop;
- PowerPoint export of WebP images; OpenType (CFF) fonts in PDFs;
- presentation slides in Study search (drag-and-drop ordering was built in
  v0.18.1);
- church templates (built in v0.18.1, see
  [`presentation-templates-v0.18.1.md`](presentation-templates-v0.18.1.md)):
  still open are reading OpenDocument (.odp) designs directly, importing
  from Google Drive without a PowerPoint download, drawing gradients,
  shadows and non-rectangular shapes instead of reporting them, and a
  per-slide choice of layout;
- the transport for a phone remote (pairing on the local network): the
  commands it will send are defined (`PresenterCommand`, see §23 of the v0.18
  record).

Deliberately **not** planned unless real use asks for them (the v0.18 Pareto
pass kept only Overview, a blank audience screen, pointer/highlighter, one
target time, three layouts, Bible passage to the audience, clicker keys and
audience-screen recovery): audience Q&A, live captions, recording and
narration, a rehearsal AI coach, complex animations and a transition library,
automatic kiosk mode, a free-form slide designer (v0.18.1's designer places
three boxes per kind of slide, nothing more), editing slide masters,
collaborative live editing, a custom shortcut editor, more pen colours,
shapes and text boxes.

### Image providers (next step after v0.16)

v0.16 separates the writing service from the image service (`ImageService`:
the same service, or OpenAI) and decides image capability from the service
(supported / unsupported / unknown). Next: Google's own image API and other
image providers as further choices, each with its own request builder and
key, without touching the writing set-up.

### Format-specific teaching canvases, inline media, templates

**Built in v0.17** (see [`study-teaching-simplification-v0.17.md`](study-teaching-simplification-v0.17.md)):
a canvas per kind of teaching (points for a sermon, questions with where they
may lead and follow-ups for a group study, steps for a lesson), lesson steps
with a kind (teaching, Bible reading, question, activity, picture; audio
reserved), starting steps for lessons, one Templates section for Study and
Teaching, and "finding" dropped as a user-facing word.

**Since v0.18.7** (see [`user-templates-v0.18.7.md`](user-templates-v0.18.7.md)):
Bible Teaching templates of the person's own (a format and the points,
questions or steps a teaching starts with, each step with its kind), the
built-in ones one per format; "Save as my template" from a teaching; and
"Add a step ▸ kind".

**Still open:** audio steps and a step-level media attachment; moving notes
between parts by dragging; the assistant inside Bible Study; a file to share
Study and Teaching templates (`.awstructure`, designed and deferred, never
`.awtemplate`); refining the built-in Teaching baselines
(`resources/teaching-templates.json`, the owner's call).
### More Materials for a Bible Teaching

**Since v0.18.4** (see [`workspace-hierarchy-v0.18.4.md`](workspace-hierarchy-v0.18.4.md)):
a teaching's outputs are gathered under one quiet **Materials** menu
(*Unterlagen*, *가르침 자료*, *Supports*, *Materiales*, *Materiais*); the
presentation is its only item so far.

**Since v0.18.6** (see [`study-flow-materials-v0.18.6.md`](study-flow-materials-v0.18.6.md)):
a manuscript (a leader's guide for a group study, a teacher's guide for a
lesson), a question sheet with a separate leader's version, and a worksheet
(listening notes for a sermon), each put together from the teaching by fixed
rules, previewed at once, printed or saved as PDF, saved as Markdown or copied;
the presentation's files are reachable from Materials too.

**Still open:** the passage's text on a sheet (in the chosen translation); a
Word (.docx) file; editable wording that belongs only to a material (deferred
on purpose: one source of truth); assistant help on materials (explicit and
bounded, as elsewhere); a printable PDF written by the core rather than the
system's print dialog (needed on macOS, whose web view has no print); more
materials (an announcement slide, a prayer sheet). Also: regenerating the
guide's screenshots.

### Study journey

**Since v0.18.6:** a Bible Study's parts are grouped into its movement
(text, understanding, theology, application, audience, teaching) with a quiet
outline that marks where one is, and an optional way on to a Bible Teaching.

**Since v0.18.7** (see [`user-templates-v0.18.7.md`](user-templates-v0.18.7.md)):
each part carries its phase from its template (built-in or the person's own),
the person can change it, and the outline follows the study's own structure;
a part without one never acquires a meaning; "Save as my template" from a
study keeps its structure only.

**Still open:** folding a whole phase at once, if owners ask for it.

### Desktop visual system

**Since v0.18.5** (see [`desktop-visual-system-v0.18.5.md`](desktop-visual-system-v0.18.5.md)):
Library, Source Reader, Settings, the presentation editor, Presenter View,
church templates and dialogs use the workspace's type levels, surfaces,
fields, actions and selected states; one hover and one selected tint; status
colours tested on every pane in all 12 palettes.

**Still open:** the owner's visual pass on Windows (see the screenshot
package); regenerating the guide's screenshots under the new system; the
remaining exceptions listed in §12 of the v0.18.5 record.
