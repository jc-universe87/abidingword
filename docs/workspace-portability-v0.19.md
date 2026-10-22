# v0.19 — Content-first workspace, teaching simplification and project portability

Baseline: `f19abbb` (owner-accepted, Windows test build `0.5.0-dev.41`).
The work came in three stages, each its own commit on
`claude/beautiful-curie-vm0eve`.

## Stage A: content-first workspace

**Information panels.** Project, Bible Study and Bible Teaching information
now open on request from a compact **Info** control, in a panel anchored to
it (`src/design-system/InfoControl.tsx`). The work underneath stays as it was.

- **Drafts.** The panel's fields are a draft, written only with **Save**, in
  one change.
- **Closing.** **Cancel**, ✕, **Esc** and a click outside close the panel and
  discard the draft. A short note says so when anything was changed. Focus
  returns to the control.
- **A failed save** keeps the panel and the draft, with the reason.
- **Changed elsewhere.** If the stored information changed while the panel
  was open, it is not overwritten: the person is told.
- **Separate actions.** Lists and actions in the panel (passages, related
  studies, duplicate, *Save as my template*, delete) act by their own
  buttons, as before.
- **The panel** is a labelled dialog (`aria-modal`) that keeps Tab inside
  while open.

**Three teaching formats.**

| Format | English | Deutsch | 한국어 | Kinds it holds |
|---|---|---|---|---|
| Message | Message (sermon / talk) | Predigt / Vortrag | 설교 / 강의 | sermon, talk, youth, other |
| Group Bible study | Group Bible study | Hauskreis | 소그룹 성경공부 | bible_study |
| Interactive lesson | Interactive lesson | Bibelunterricht | 참여형 공과 | lesson, children |

Every stored kind belongs to exactly one format, so teachings and templates
from before keep their kind and open as they were.

- **The kind** can still be changed in the information panel, grouped by
  format.
- **German.** The kind `bible_study` is now *Hauskreis*.
- **New teaching.** **+ New Bible Teaching** is one restrained, labelled
  action on the teaching's line.
- **Notes.** *Notes for yourself* are folded at the end, and the line says
  when they hold something.
- **Header.** The teaching's header is one line: Info, the switcher, the new
  action and the Bible text.

## Stage B: Settings and data portability

**Settings.** Open sections sit on a quiet shaded ground. A new **Data and
backup** section holds four separate actions:

- Export project;
- Import project;
- Back up everything;
- Restore from backup.

Each project's Info panel also has *Export project…*. The formats, checks
and transactions are documented in [portability.md](portability.md).

- **Project files** (`.awproject`).
  - **Contents.** A versioned zip whose manifest lists every entry with its
    size and SHA-256, and the project's own rows as JSON data.
  - **Always new.** An import always creates a new project in one
    transaction, with new ids and remapped references.
  - **Free title.** It gets a free title, such as *John (2)*.
  - **Missing dependencies** are reported before importing: library sources,
    church templates and Bibles.
- **Backups** (`.awbackup`).
  - **Database.** A verified `VACUUM INTO` snapshot, never the live file or
    its WAL.
  - **Files.** Everything in `sources/`.
  - **Never included:** API keys or other secrets, the cache, logs and
    earlier backups.
- **Restore.**
  1. A preflight of every part.
  2. A verified safety copy in `backups/pre-restore/`.
  3. The backup API into the open connection, then the start-up steps.
  4. The safety copy is put back on any failure.
  5. Library files that differ are set aside, never deleted.

**Safety.** These are refused, with nothing changed:

- path traversal, absolute paths and drive letters;
- unlisted, missing or repeated entries;
- tampered parts and oversize entries;
- newer formats or schemas;
- foreign databases, unknown tables or columns, and unreadable JSON
  columns.

Nothing in a package is ever run. Column names must be the app's own, so
package names never become SQL.

## Stage C: the example project

**Example: Abiding in Christ — John 15:1–11**
(`resources/sample/abiding-in-christ.json`, installed by
`src-tauri/src/sample.rs`):

- **The study.** One Bible Study (the passage-study template) with written
  parts and seven notes.
- **Three teachings** from it:
  - a message (*Remain in Me*, sermon);
  - a Hauskreis (*Branches of the True Vine*, group Bible study);
  - an interactive lesson (*Stay Connected to Jesus*, youth).

The lesson's steps have kinds: question, Bible reading, activity, teaching.

- **Added only on request**, from *Settings › Data and backup › Add the
  example project*.
- **Built into the app**, so it works offline.
- **Clearly an example.** The title begins *Example:*, and the description
  says it is an example.
- **Never twice.** Asking again while it is there adds nothing: its project
  is remembered in the settings table. Once deleted, it can be added again.
  If adding fails half-way, the partial project is removed.
- **Language.** The content is English prose; the interface around it is in
  all six languages.
- **Quotations.** The few short ones are from the World English Bible
  (public domain). No third-party text is included.

## Data model

**No migration** and no schema change. There is one new settings key,
`sample.abiding-in-christ`, holding the example project's id. rusqlite's
`backup` feature is enabled; it adds no crates and `Cargo.lock` is
unchanged.

**New commands**, each granted to the main window only:

- `project_export`, `project_package_inspect` and `project_import`;
- `backup_create`, `backup_inspect` and `backup_restore`;
- `sample_project_install`.

## Screenshots

`docs/images/workspace-portability-v0.19/` holds 63 images, made with
`tests/screenshots/v019.mjs`. File names are
`<scene>-<language>-<theme>-<width>[-before].png`. The `-before` images come
from the baseline `f19abbb`.

| Scenes | Shows |
|---|---|
| `study`, `study-info` | Bible Study with its information closed and open |
| `teaching`, `teaching-info` | Bible Teaching with its information closed and open |
| `hauskreis` | the example's group Bible study being written |
| `new-teaching` | creating a new Bible Teaching: the three formats |
| `settings-data`, `import-preview`, `restore-preview` | Settings › Data and backup |
| `sample-study`, `sample-teaching` | the example project |

**Coverage:**

- English in light and dark at 1280 px;
- German and Korean at 760 px (narrow);
- French, Spanish and Portuguese at 1280 px;
- dark information panels in all six languages;
- *before* for Study, Teaching, the new-teaching form and Settings.

## Tests

- **Interface.** `tests/ui/info-overlays.test.tsx`,
  `teaching-formats.test.tsx` and `portability.test.tsx`, plus updated
  tests across the suite.
- **Rust.** `src-tauri/tests/portability.rs` runs on temporary data folders:
  - a round trip, and a repeated import into the same computer;
  - deleted parts left behind;
  - crafted and damaged packages;
  - data-only project JSON, with rollback;
  - backup, snapshot and secrets, damaged backups, newer versions;
  - a failed restore rolled back.

  `src-tauri/tests/sample.rs` covers the example project: added once, its
  content, and added again after deletion.

## Known limits

- **Assistant help.** Audience and purpose lost their assistant help:
  they are now drafts in the information panel.
- **Related studies** show only in the Bible Study information panel.
- **A new teaching's information** no longer opens by itself after it is
  created.
- **What a project file carries.** It names library books, Bible texts and
  church templates but does not carry them. A citation of a library book
  that is not there is left out; the note keeps its text. Offline copies of
  found images are not carried.
- **The example project's content** is English only.
- **A detection detail.** In the example's group study opening, the inline
  reference detector reads *John 15:1–11* (with an en dash) as John 15:1.
  This is existing behaviour of the detector, not of v0.19.
- **The restore button.** *Restore from backup* replaces everything: there
  is no partial restore.
