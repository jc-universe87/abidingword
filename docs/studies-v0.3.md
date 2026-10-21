# Abiding Word — Studies v0.3 implementation notes

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Studies](guide/04-studies.md)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

How the Study becomes the primary object of work (Phase 3 in
[`architecture.md`](architecture.md) §58). The frozen
[`architecture.md`](architecture.md) and [`concept.md`](concept.md) remain
the authority. Foundation: [`foundation-v0.1.md`](foundation-v0.1.md);
Scripture: [`scripture-v0.2.md`](scripture-v0.2.md).

## Hierarchy

Unchanged from Foundation:

```text
Workspace
 └── Project
      └── Study ──── Findings (structured, reusable)
           │   ├──── Passages (primary / related, canonical)
           │   └──── Relations to other studies
           └── StudySection
                └── StudyBlock
```

A study accumulates writing (sections and blocks) **and** structured
findings. Findings are separate records, not paragraphs, so they can be
filtered, linked to Scripture, searched and, later, reused across studies.

## Study types and status

`studies.study_type` (stable codes; labels live in the interface):

| Code | Shown as | Built-in template |
|---|---|---|
| `passage` | Passage Study | Passage Study |
| `word` | Word Study | Word Study |
| `topical` | Topical Study | Topical Study |
| `biblical_theology` | Biblical Theology Study | Biblical Theology Study |
| `systematic_theology` | Systematic Theology Study | Systematic Theology Study |
| `teaching` | Teaching / Sermon | Teaching / Sermon Preparation |
| `custom` | Custom Study | none (one "Notes" section) |

The type suggests a template, shows a few optional details and adjusts
wording; it never fixes a workflow. Status: `active`, `paused`,
`completed`, `archived` — no workflow, and a completed study stays
editable. `description` holds the study's purpose. `details` (JSON) keeps
optional type-specific fields: word studies `lemma`, `originalLanguage`,
`lexicalId`; teaching studies `audience`, `duration`, `teachingFormat`.
They are stored and shown only; the concordance and teaching-artifact
engines are later milestones.

## Findings

Types: `observation`, `interpretation`, `question`, `quotation`,
`doctrine`, `application`, `illustration`, `teaching_idea`,
`unresolved_issue`, `conclusion`.

Each finding has `id`, `study_id`, optional `section_id` (otherwise it
belongs to the whole study), type (column `kind`, from 0001), `content`,
`sort_order`, optional `parent_id` (threading, not yet in the interface),
`created_at`, `updated_at`, `revision`, soft delete. Optional relations:

- **Passages** — any number, stored in `passage_references` with
  `finding_id` as owner (0001 already allowed it). Canonical, so they
  survive translation switching and translation removal (tested).
- **Tags** — `finding_tags`, lower case, trimmed, up to 20 per finding.
- **Sources** — `finding_sources` (finding ↔ source, optional segment and
  locator such as a page). **Data model only**; the Library phase fills it.
  No source records are created in normal use. (Filled in Library v0.4:
  see [`library-v0.4.md`](library-v0.4.md), "Finding citations".)

Interface: quick capture (Observation, Question, Interpretation,
Application, Conclusion as buttons; all ten types available), optional
section, optional "Link current passage", Ctrl+Enter to save; a type filter;
each finding editable in place (autosave), retypable, movable, taggable,
deletable with confirmation; its passages open the Scripture pane.

## Study ↔ Scripture

- **Study passages**: `passage_references` rows owned by the study, each
  with `role` `primary` or `related` (at most one primary per study,
  enforced by a unique index). A study may have none. Migration 0003 made
  the earliest existing link of each study primary.
- **Current passage**: the verse clicked in the reader, otherwise the
  passage last navigated to. Studies and findings offer "Link current
  passage" only when one exists, and never link it without the user
  choosing to.
- **Primary passage on opening**: when the user opens a study from a list,
  search result or related-study link, the Scripture pane moves to the
  study's primary passage once. Returning to the last study at app start,
  and anything done inside the study, leave Scripture where the user put it.
- Passages mentioned in study text are links (from v0.2).

## Sections and blocks

Sections can be added (at the end, with one empty paragraph), renamed,
given guidance, moved and removed. Removing a section that still has
writing or findings needs confirmation; the core decides this from the
database after pending saves have finished, so text typed a moment ago is
counted. Its blocks are removed with it; its findings stay in the study
as study-level findings.

Block types: `paragraph`, `note`, `heading`, `quotation`, `question`
(validated in Rust, not by the schema; new types need no migration).
Blocks can be moved within their section. Editing stays plain text with
autosave; no rich-text framework.

## Templates

A template defines structure only: name, description, intended study
type, ordered sections with optional guidance. Stored in `study_templates`
(sections as JSON in `definition`, in order; `study_type` added by 0003).

- **Built-in** templates are JSON files in `resources/templates/`
  (`passage-study`, `word-study`, `topical-study`,
  `biblical-theology-study`, `systematic-theology-study`,
  `teaching-study`), compiled in and installed or refreshed at startup.
  They cannot be edited or deleted; "Save as my template" (until v0.18.7
  "Duplicate and customise") makes a user copy.
- **User** templates can be created, renamed, described, retyped, have
  sections added, renamed, reordered and removed, duplicated and deleted
  (Settings → Study Templates).
- **Applying**: a new study copies the template's sections. It keeps the
  template's id for reference only; later changes to, or deletion of, the
  template never change existing studies (tested).

Since v0.18.8 a built-in template file may say `"offered": false` (kept for
old studies, never offered), and every place a template is chosen shows what
it starts with, from its own parts: see
[`baselines-materials-v0.18.8.md`](baselines-materials-v0.18.8.md).

Since v0.18.7 each section of a template may say its **phase** (where it
belongs in the study outline), a study copies it with its key, and a study's
structure can be saved as a template of the person's own: see
[`user-templates-v0.18.7.md`](user-templates-v0.18.7.md).

## Creating and duplicating studies

New Study: title, type, template (the type's built-in template is
suggested; any template can be chosen, or none), optional passage (becomes
primary). Duplicate: "Structure only" (default: sections with guidance and
order, empty) or "Structure and content" (also blocks, findings with their
passages and tags, and study passages). Never copied: relations to other
studies, and Scripture annotations (they belong to the verses).

## Relations between studies

`study_relations`: from study, to study, type (`related`, `continues`,
`contrasts`, `supports`, `custom`), optional note. No self links; one live
link per pair in either direction. Shown from both sides ("Continues" /
"Continued by"). The interface can add, show, open and remove them.

## Study search

`study_search` (FTS5) indexes study titles and purposes, section titles,
non-empty blocks and findings. `study_search_items` gives each indexed item
a stable integer id used as the index row id; triggers on `studies`,
`study_sections`, `study_blocks` and `findings` keep index and map in step
on insert, update, soft delete and hard delete, so no code path can forget
to update search. A test checks the index never holds orphaned rows.

The top bar has an explicit scope: **Scripture** or **Studies**. Study
results show the study, where the match is ("Title or purpose", "Section
title", a section name, "Finding: Question") and a snippet with the match
highlighted; choosing one opens the study. Search is word-based
(FTS5 `unicode61`, accent-insensitive, no stemming), at most 100 results,
ranked by relevance.

## Lists and filtering

Study lists use a summary query (title, type, status, primary passage,
finding count, last change) and never load sections or blocks; detail
loads only when a study is opened. Filters: project, type, status. The
Projects page lists all studies; a project page lists its own.

## Keyboard

*(Changed after v0.3.)* v0.3 shipped Alt-based global shortcuts while a study
was open (Alt+N, Alt+O, Alt+Q, Alt+↓/↑, Alt+G) and listed them in Settings.
They are removed: Windows and its web view intercept Alt combinations
unreliably, and they are not needed now. Global keyboard shortcuts are
deferred until a deliberate cross-platform shortcut scheme is designed and
tested. Normal keyboard use (Tab, Enter/Space, Escape, visible focus) is
unchanged, and **Ctrl+Enter** still saves the finding being written, with the
hint shown beside the editor.

## Migration 0003

Additive; 0001 and 0002 unchanged.

| Change | Detail |
|---|---|
| `studies` | + `study_type` (default `passage`: every earlier study came from the passage template), `status` (default `active`), `description`, `details`; index on type/status |
| `findings` | + `sort_order`, `parent_id`; index on study/order |
| `finding_tags`, `finding_sources` | new |
| `passage_references` | + `role` (study passages: earliest primary, others related); unique index: one live primary per study |
| `study_relations` | new; no self links; unique live pair |
| `study_templates` | + `study_type` (`passage` for the existing built-in) |
| `study_search_items`, `study_search` | new; 12 triggers; existing content indexed during the migration |

Upgrades run through the Foundation safety path (integrity check, verified
backup to `backups/pre-migration/`, then migration). Tests build a v1 and a
v2 database with plain SQL against the old schema (never with today's
code) and check that workspace, projects, studies, sections, blocks,
study passages, annotations, Bible translations and their text, and
settings all survive, that a backup is made first, and that a blocked
backup leaves the database untouched.

## Version history

Every study record keeps `revision` (+1 per change), `created_at`,
`updated_at` and soft delete, which is what a history feature needs to
attach to. No snapshots are stored yet. Planned attachment point: a
`revisions` table keyed by (table, id, revision) holding the previous
content, written by the repository functions that already increment
`revision` (architecture §34). Not built in v0.3.

## Known limitations

- Findings: no nesting in the interface (the `parent_id` column exists);
  no cross-study findings view yet; tags are free text without a list of
  existing tags.
- Moving items uses up/down buttons; no drag and drop. Findings can be
  moved only when no type filter is active.
- Template editing replaces the whole section list on save; there is no
  "update this study from its template".
- Duplicating with content makes the copied findings keep their section
  mapping but not their creation dates.
- Study search is word-based: no stemming ("abide" does not find
  "abiding"), no phrase-near search, no semantic search.
- Section guidance can be set through templates and the core, but the
  study page has no field to edit a section's guidance yet.
- Relations have no note field in the interface (stored when supplied).

## Deferred

AI, concordance and original-language engines, source ingestion (only the
finding ↔ source model exists), teaching artifacts, publication, version
history interface, sync and integrations, as in the frozen plan.
