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
[`passage-aware-sources-v0.9.md`](passage-aware-sources-v0.9.md)). Remaining:
Greek and Hebrew forms, tolerance of looser natural phrasing, and use of the
interface language for typed input.

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

**Still open:** the assistant in the Study itself (findings, sections) and in
the Library (summarising a source with provenance); research modes beyond one
teaching ("my library only", "compare these three commentaries"); a record of
accepted assistant wording; a persistent Linux key store; search through an AI
service's own search tool; copying teaching preparations with a study and
finding them in study search.

## 3. Backup and sync versus export and publication

These are different problems and stay separate.

**A. Workspace sync / backup.** Abiding Word stays local-first; the internal
workspace and database are authoritative. Possible providers: Nextcloud /
WebDAV, Google Drive, Microsoft OneDrive, Dropbox, a local folder, other
generic filesystem or cloud providers. Goals: backup, multi-device
synchronisation, restore. The live SQLite file is never edited or synced
directly; the planned change journal, conflict-aware synchronisation,
backup-first approach and `SyncProvider` abstraction apply (see
`architecture.md`, synchronisation sections).

**B. Document export / publication.** Users turn their own work into portable
documents: Markdown, DOCX, PDF, PowerPoint, and plain text where useful.
Material could include a Study, a sermon or teaching manuscript, a teaching
outline, findings, study notes, selected Scripture references and
bibliography/citations. An export may then optionally be saved to the local
filesystem or a cloud destination.

```
Abiding Word workspace
   |-- Sync / Backup provider
   `-- Exporter
         |-- Markdown / DOCX / PDF / PowerPoint
         `-- destination: local | cloud
```

Cloud providers must not be hard-wired into the internal data model.

## 4. Formatted sources

Today: PDF **Original** view, formatted EPUB and DOCX **Original** views (v0.8),
**Contents** (the source's own PDF outline, EPUB table of contents or DOCX headings),
**internal links and footnotes** in a PDF's Original view and in an EPUB's
Reading and Original views, and **Back / Forward** reading history — see
[`formatted-source-viewer.md`](formatted-source-viewer.md),
[`source-navigation-v0.7.md`](source-navigation-v0.7.md) and
[`formatted-epub-v0.8.md`](formatted-epub-v0.8.md) and
[`formatted-docx-v0.8.md`](formatted-docx-v0.8.md). Backlog:

- **PDF:** following links that leave the document (web links are shown to
  nobody today), named actions such as "next page", and links inside
  Reading's extracted text.
- **EPUB:** embedded fonts, fixed-layout and
  vertical-writing books, inline SVG/MathML, a text-size control, and
  making marks directly on the formatted view (they are shown there since
  v0.14).
- **History** beyond one reading session (it is kept in memory only, per
  source), and across sources.
- **DOCX:** headers and footers, text boxes and shapes, charts and equations,
  heading numbers from multilevel lists, other number formats, table widths and
  borders, links inside Reading's text, caching the parsed document between
  parts, and the EPUB items above that apply (text size, making marks there). Web links
  open in the system browser (`http`/`https` only) in both formatted views;
  `mailto:` and other schemes stay blocked until deliberately designed.
- **Generated contents:** built in v0.13 (accepted): headings of
  EPUB, Markdown and Word sources, and conservative probable headings of a PDF,
  always labelled *Generated contents*. Open: bold type as PDF evidence (the
  extractor does not report weight), a Word document's own TOC field, and
  find marks drawn inside the EPUB / Word Original views.
- **PDF Bible:** viewing the original document is distinct from Structured
  Scripture. Future work is verified book/chapter/verse extraction with
  uncertainty/confidence, provenance and versification handling, and **no
  invented verse structure.**

## 5. Stable signed release and updater channel (infrastructure)

**BACKLOG / FUTURE — not built.** Today a milestone is released as a validated
`main` plus an **annotated milestone tag** (`studies-v0.3`, `library-v0.4`,
`scripture-annotations-v0.5`). The normal *Native builds* workflow attaches
unsigned installers to the tag's run as short-lived workflow artifacts, and the
only signed distribution is the **test** update channel, published
automatically for every green `main` ([`updates.md`](updates.md)). There is no stable GitHub Release, no stable
signed installer and no stable update endpoint, and test builds never read one.

A production distribution channel is separate infrastructure work. It should
later cover:

- production signing of installers and updater artifacts;
- a production updater endpoint and repository, with test builds still reading
  only the test channel and stable builds never seeing test updates;
- a stable release workflow, run from a tagged commit;
- a GitHub Release / public artifact policy, if desired;
- key and secret management, kept apart from the test key;
- rollback and recovery (withdrawing a bad release, pointing clients back).
