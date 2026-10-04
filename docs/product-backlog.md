# Abiding Word — Product backlog and principles

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

### Simplify Study creation (UX)

Study creation currently asks for both a **study type** and a **template**.
Both are useful internal concepts but are too rigid and repetitive as separate
mandatory choices. Future direction: the user chooses *what they want to do*,
not internal metadata.

> What would you like to study?  
> **[ Bible passage or reference ]**  
> then simple choices such as *Passage study*, *Word study*, *Topic*,
> *Teaching preparation*, *My template*.

Internally the study may still store type, template id, purpose, status and
metadata; they need not each be a separate UI decision. The data concepts are
**not** merged merely to simplify the screen: simple UI over expressive
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

### Study workspace UX simplification (high priority)

The Study / Project workspace currently shows too many internal concepts at
once: title, active/status, template, type, empty-findings messages,
purpose/goal, primary passage, related passages, linked items and studies,
text blocks and several Add controls. User feedback: too cluttered.

**Rule: show only what the user needs at the current moment.** The workspace
should be redesigned around progressive disclosure. The first impression is:
what passage or topic is being studied, the study content itself, and the next
natural action. Internal metadata stays available but largely leaves the
normal study surface.

- **Title**: derived automatically where sensible, editable in place, not a
  permanent form field.
- **Type / template**: may stay separate internally, but should not be two
  separate conceptual decisions in normal use. Chosen mainly at creation and
  hidden afterwards unless the user wants to change or customise.
- **Status**: not prominent; move to Study details/settings if needed.
- **Purpose / goal**: optional; reveal only when genuinely useful (e.g.
  teaching preparation).
- **Primary passage**: no redundant form field when it is already obvious.
- **Related passages**: a quiet "+ Related passage" action; existing ones
  shown compactly.
- **Links, related studies, findings**: hidden until present or requested.
- **Adding content**: avoid several competing Add buttons; one obvious action
  can reveal the relevant content types.

Core test: *the user should be studying Scripture, not operating the Study
data model.* (See the principle in [`concept.md`](concept.md) §3a.)

### Document annotations and ink (future milestone)

**Document Annotations & Ink** is a separate system from the structured
Scripture annotations of v0.5. For PDF sources, including PDF Bibles, future
support would include: text highlighting; notes attached to text, a page or a
location; page/location bookmarks; freehand pen/stylus markup (underline and
shapes possibly later); exact navigation back to the annotated page or
location. The original PDF stays untouched and annotations are stored
separately.

| | Structured Scripture annotations (v0.5) | Document / PDF annotations (future) |
|---|---|---|
| Tied to | canonical verse / phrase | one source document |
| Position | canonical reference, translation-aware | page, text or location |
| Ink | no | yes |
| Works without structured Scripture | no | yes |

For a PDF Bible the two may eventually be linked **only if reliable verse
mapping exists**. Page annotations never automatically correspond to
canonical Scripture and no verse mapping is invented.

The Marks view should eventually be able to surface Scripture notes,
highlights and bookmarks, PDF/source notes, highlights and bookmarks, and ink
together, hiding the technical distinction unless the user needs it. Stylus
support should consider Windows pen, touch devices, tablets and pen-enabled
laptops, a smooth handwriting experience, and pressure/stroke data only if
needed.

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

It should later shape command names, buttons, prompts, output size,
provenance, UI wording and the review workflow. No AI is implemented.

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

Today: PDF **Original** view, **Contents** (the source's own PDF outline or
EPUB table of contents), **internal links and footnotes** in a PDF's Original
view and in an EPUB's Reading view, and **Back / Forward** reading history —
see [`formatted-source-viewer.md`](formatted-source-viewer.md) and
[`source-navigation-v0.7.md`](source-navigation-v0.7.md). Backlog:

- **PDF:** following links that leave the document (web links are shown to
  nobody today), named actions such as "next page", and links inside
  Reading's extracted text.
- **EPUB:** a formatted renderer (Original view), and chapter navigation
  beyond Contents and links. Links and Contents already navigate the
  extracted-text Reading view; a renderer could reuse the same tree and
  the same link data.
- **History** beyond one reading session (it is kept in memory only, per
  source), and across sources.
- **DOCX:** formatted viewing, links and footnotes (not started).
- **Generated contents:** deriving a table of contents from headings for a
  source that has none — a possible later fallback, **not** current
  behaviour; today a source without contents simply shows none.
- **PDF Bible:** viewing the original document is distinct from Structured
  Scripture. Future work is verified book/chapter/verse extraction with
  uncertainty/confidence, provenance and versification handling, and **no
  invented verse structure.**

## 5. Stable signed release and updater channel (infrastructure)

**BACKLOG / FUTURE — not built.** Today a milestone is released as a validated
`main` plus an **annotated milestone tag** (`studies-v0.3`, `library-v0.4`,
`scripture-annotations-v0.5`). The normal *Native builds* workflow attaches
unsigned installers to the tag's run as short-lived workflow artifacts, and the
only signed distribution is the **test** update channel
([`updates.md`](updates.md)). There is no stable GitHub Release, no stable
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
