# Abiding Word — Product backlog and principles

> **BACKLOG / FUTURE.** Nothing in this document is built, scheduled or
> promised. It records product-owner decisions so that today's code does not
> make them harder later. The frozen [`architecture.md`](architecture.md) and
> [`concept.md`](concept.md) remain the references for what the product is.

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

Today: PDF **Original** view and **Contents** (the source's own PDF outline or
EPUB table of contents) — see
[`formatted-source-viewer.md`](formatted-source-viewer.md). Backlog:

- **PDF:** internal hyperlinks and destinations beyond outline entries,
  footnote/endnote links, back/forward reading history.
- **EPUB:** a formatted renderer, internal links, chapter navigation beyond
  Contents, footnotes/endnotes, back/forward history. Contents already
  navigate the extracted-text Reading view; a renderer could reuse the same
  tree.
- **Generated contents:** deriving a table of contents from headings for a
  source that has none — a possible later fallback, **not** current
  behaviour; today a source without contents simply shows none.
- **PDF Bible:** viewing the original document is distinct from Structured
  Scripture. Future work is verified book/chapter/verse extraction with
  uncertainty/confidence, provenance and versification handling, and **no
  invented verse structure.**
