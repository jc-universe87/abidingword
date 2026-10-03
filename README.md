# Abiding Word

**Bible Study Workspace** — *Study with diligence. Teach with love.*

Abiding Word is a local-first desktop application for serious Bible study.
It runs entirely on your own computer: no server, no account, no internet
connection needed. Your studies are stored in one folder that you own.

The workflow it is built around: **Word → Understanding → Teaching**.

## Status: Library v0.4 in development (on Studies v0.3, Scripture v0.2 and the frozen Foundation v0.1)

Foundation v0.1 (with its hardening: integrity check and pre-migration
backup) provides:

- a three-pane workspace: **Scripture | Study | Sources**
- projects that group studies (e.g. *Romans Sermon Series*)
- studies created from a passage-study template with nine sections
  (Text, Context, Observations, Structure, Exegesis, Theology, Application,
  Audience, Teaching)
- simple editing with paragraph, note and heading blocks, saved automatically
- a local SQLite database with versioned migrations
- settings showing the version and data folder, and a light/dark theme

Scripture v0.2 adds a real, offline Scripture engine:

- canonical references (`JHN.15.7`, `ROM.8`) independent of any translation
- a passage reader with book/chapter navigation, typed references
  (“Rom 8:1-17”) and translation switching that keeps your place
- the World English Bible (public domain) included, added by the user
- importing your own Bibles in USFM (a .zip or .usfm files) through a
  plain-language verification screen
- notes, highlights and bookmarks on verses that survive translation changes
- studies linked to their passages; passages mentioned in study text
  become links
- Scripture search (words and exact phrases)
- Settings → Bible Texts to review and remove Bibles

Details: [`docs/scripture-v0.2.md`](docs/scripture-v0.2.md).

Studies v0.3 makes the study the centre of work:

- study types: passage, word, topical, biblical theology, systematic
  theology, teaching/sermon, custom — each with a built-in template
- structured findings (observations, questions, interpretations,
  applications, conclusions and more) linked to Scripture, filterable and
  searchable
- primary and related passages; opening a study shows its passage
- your own study templates (duplicate and customise the built-in ones)
- editable, reorderable sections; quotation and question blocks
- links between related studies, study status, duplication
- search across your studies, separate from Scripture search
- keyboard shortcuts for quick capture

Details: [`docs/studies-v0.3.md`](docs/studies-v0.3.md).

Library v0.4 (branch `feature/library-v0.4`, not yet merged) adds a
personal source library:

- add PDF (with a text layer), EPUB, Markdown and text files; Abiding Word
  keeps its own copy and never changes the original
- a preview before adding: what was found, Bible references detected,
  scanned PDFs and duplicates explained in plain words
- exact provenance for every paragraph: page (PDF) or chapter and heading
  (EPUB, Markdown)
- library search with provenance, as a third search scope beside
  Scripture and Studies
- "Sources mentioning this passage" in the Sources pane, found from the
  Bible references in each source
- findings can cite a library passage; citations survive removal of the
  source as a record
- a licence status per source (by default: my own copy, not to be shared)

No OCR, AI or network access. Details:
[`docs/library-v0.4.md`](docs/library-v0.4.md).

Since v0.4 (development): a PDF source can be read as extracted text
(*Reading*) or inspected as the real document in the app (*Original*), and
the Sources pane has the same Reading | Original switch, so the PDF can be
inspected without leaving Scripture and the Study; the full reader is an
optional expansion that keeps the place, and its Back button stays in a header
that does not scroll away. See [`docs/formatted-source-viewer.md`](docs/formatted-source-viewer.md).

**Not yet, planned for later phases:** OCR and transcription, concordance
and original-language tools, AI assistance, sync, integrations and MCP.

## Architecture in brief

- **Tauri 2** desktop shell (no Electron). The installed app needs no other
  runtime.
- **React + TypeScript + Vite + Tailwind CSS** for the interface (`src/`).
- **Rust** native core (`src-tauri/`) owns the data folder, the SQLite
  database, migrations, logging and errors.
- The interface talks to the core only through typed Tauri commands
  (`project_create`, `study_get`, …). No SQL crosses that boundary.

The authoritative baseline is the frozen
[`docs/concept.md`](docs/concept.md) and
[`docs/architecture.md`](docs/architecture.md). How this release implements
it: [`docs/foundation-v0.1.md`](docs/foundation-v0.1.md),
[`docs/scripture-v0.2.md`](docs/scripture-v0.2.md),
[`docs/studies-v0.3.md`](docs/studies-v0.3.md) and
[`docs/library-v0.4.md`](docs/library-v0.4.md).

## Milestones

| Milestone | State | Notes |
|---|---|---|
| Foundation v0.1 | complete, frozen | shell, data folder, migrations, integrity check, pre-migration backup |
| Scripture v0.2 | complete | canon, references, reader, Bible import, annotations, search |
| Studies v0.3 | complete (tag `studies-v0.3`) | study types, findings, templates, relations, study search |
| Library v0.4 | in development (`feature/library-v0.4`) | PDF/EPUB/Markdown/text import, provenance, library search, passage mentions, finding citations |

## Supported platforms

Desktop first: **Linux**, **Windows** and **macOS** (Tauri 2). Development
and the release builds so far have been done on Debian-family Linux; the
code has no Linux-only parts, but Windows and macOS builds have not been
verified yet. A Chromebook works through its Linux development environment,
which is Debian-based, so the Linux instructions below apply there too.

## Getting started

### Prerequisites

- **Node.js 20.19 or newer** with **npm 10 or newer**. Debian's packaged
  npm 9.2 cannot install these dependencies; use a Node.js release that
  ships npm 10, or run `npx -y npm@10 ci` in place of `npm ci`.
- **Rust** (stable, 1.82 or newer) via [rustup](https://rustup.rs):

  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

- **Platform libraries for Tauri.** On Debian, Ubuntu, Parrot and a
  Chromebook's Linux environment:

  ```sh
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

  For other systems (Fedora, Arch, macOS, Windows) follow the official
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Clone, install, run

```sh
git clone https://github.com/<you>/abiding-word.git
cd abiding-word
npm ci                                   # exact versions from package-lock.json
ABIDING_WORD_DATA_DIR="$PWD/.aw-data" npm run tauri dev
```

The first Rust build downloads and compiles Tauri and takes a while; later
builds are incremental. On a machine with little memory, limit parallel
compilation: `CARGO_BUILD_JOBS=2 npm run tauri dev`.

### Commands

| Task | Command |
|---|---|
| Install dependencies (from the lockfile) | `npm ci` |
| Run the desktop app in development | `npm run tauri dev` |
| Build installers for this platform | `npm run tauri build` (Linux `.deb` only: `npm run tauri build -- --bundles deb`) |
| Interface tests | `npm test` |
| Native (Rust) tests | `npm run test:rust` |
| Type check | `npm run typecheck` |
| Lint (TypeScript) | `npm run lint` |
| Lint (Rust, warnings are errors) | `npm run lint:rust` |
| Everything above except build | `npm run check` |

Build output lands in `src-tauri/target/release/bundle/`.

### Development workflow

GitHub is the source of truth; heavy builds run there, not on the
development machine.

- **Local development.** Clone once, then `git switch <branch>`,
  `git pull`, `npm run tauri dev`.
- **Remote validation.** Every push to `main`, `feature/**`, `fix/**` or
  `chore/**` and every pull request to `main` runs **CI**
  (`.github/workflows/ci.yml`): *Frontend* (typecheck, lint, tests, build)
  and *Rust* (format, clippy with warnings as errors, tests).
- **Test installers.** **Native builds**
  (`.github/workflows/native-builds.yml`) produces unsigned installers as
  workflow artifacts, kept 14 days: `Abiding-Word-Windows-x64` (`.msi`,
  setup `.exe`) and `Abiding-Word-Linux-x64` (`.deb`, `.rpm`, `.AppImage`).
  It runs on pushes to `main`, on tags, and when started by hand:
  GitHub → Actions → Native builds → Run workflow → choose the branch.
  The optional *selection_spike* input sets `VITE_SELECTION_SPIKE=1` for a
  development check panel on branches that have one; normal builds never
  set it. A push whose commit message contains `[native-build]` also
  builds that branch. Download the artifact from the finished run's page.
  Windows SmartScreen warns about these unsigned installers ("More info →
  Run anyway"). Artifacts are for testing; annotated tags mark releases.
- **Platform testing.** CI does not replace trying the real app.
  **Windows desktop is the primary visual and manual acceptance
  platform**, and normal test builds reach it through the signed
  test-update channel below. The **Chromebook (Linux, WebKitGTK) is a
  secondary compatibility check** at selected checkpoints (text selection
  and other WebKitGTK-specific behaviour, Linux packaging); it is not needed
  for every interface iteration. Linux builds and CI stay supported.
- **Windows test updates.** An explicitly published, signed test build can
  be offered to an installed test build of Abiding Word (Settings →
  Updates, plus a notice after startup). Nothing is published by a push.
  See [`docs/updates.md`](docs/updates.md) for the channel, the one-time
  key setup and the version scheme.

On the Windows laptop, either install the `Abiding-Word-Windows-x64`
artifact, or keep a development clone (one time: clone, install the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), `npm ci`;
then `git switch <branch>`, `git pull`, `npm run tauri dev`). No ZIP
downloads of the repository are needed.

Rules for every contributor, human or agent: work on an explicit feature
branch; fetch before starting; make focused commits; push normally; CI must
pass; no unreviewed work directly on `main`; no force-pushing or history
rewriting unless explicitly authorised; no credentials or tokens in the
repository. Native acceptance still happens on real target systems.

### Interface languages (i18n)

The interface is available in English, German, Korean, French, Spanish and
Portuguese (`en`, `de`, `ko`, `fr`, `es`, `pt`), chosen in Settings →
Language (by default the system language, else English). **All new
user-facing text must go through i18n** — visible labels, headings,
buttons, tooltips, dialogs, notices, empty states, user-visible errors,
placeholders, `aria-label`s and other accessibility text, and colour names
shown to users — in all six languages. `npm run i18n:check` (also in CI)
checks that the languages stay aligned and that components contain no
hard-coded text. How it works, the terminology guide and how to add a
string: [`docs/i18n.md`](docs/i18n.md).

### Keeping development data separate

`ABIDING_WORD_DATA_DIR` points the app at a different data folder, so
development and testing never touch your real studies. Use a folder outside
the repository, or `.aw-data/` inside it (ignored by Git):

```sh
ABIDING_WORD_DATA_DIR="$PWD/.aw-data" npm run tauri dev
```

The webview (the embedded browser that draws the window) keeps a few
interface preferences — pane widths, the last place in the Study pane — in
its own per-user folder (Linux: `~/.local/share/app.abidingword.desktop/`),
which `ABIDING_WORD_DATA_DIR` does not change. It holds no study data.

### Never commit private or imported material

Abiding Word is built for the user's own library: Bibles they own,
commentaries, books, notes. None of that belongs in this repository.
Do not commit databases, data folders, imported Bibles or books, PDFs,
EPUBs, personal notes or studies. The only Bible text in the repository is
the public-domain World English Bible in `resources/scripture/`, with its
licence and checksum in `SOURCE.md`. Test fixtures are invented text or are
generated by the tests; any new fixture must say where it came from.
`.gitignore` blocks the common cases (`*.db`, `.aw-data/`, logs), but it
cannot know what is private: check `git status` before committing.

## Repository layout

```text
src/                  React interface
  app/                startup, shell, error screens
  layouts/            app bar, three-pane layout
  features/           scripture, studies, library, settings, ai (empty)
  design-system/      brand tokens, base styles, shared components
  hooks/ lib/ types/  data loading and autosave, API boundary, domain types
src-tauri/            Rust native core
  src/                commands, db, domain, filesystem, integrations, state
  migrations/         versioned SQL migrations
  tests/              database and domain tests
  icons/              platform icons generated from the brand app icon
resources/
  templates/          the six built-in study templates (JSON)
  scripture/          included Bible texts, each with SOURCE.md (licence)
  icons/              brand source icons
docs/                 concept, architecture and per-milestone notes
tests/                interface tests and test support
```

## Where your data is stored

| OS | Folder |
|---|---|
| Linux | `~/.local/share/Abiding Word/` |
| macOS | `~/Library/Application Support/Abiding Word/` |
| Windows | `%APPDATA%\Abiding Word\` |

Inside: `database/abiding-word.db` (all studies and the library's text),
`sources/` (Abiding Word's copies of the files added to the library),
`backups/` (automatic copies made before a database upgrade), `logs/`, and
folders reserved for later phases (`indexes/`, `cache/`, `sync/`,
`exports/`). The exact path is shown in **Settings**.
To back up everything, copy this folder while the app is closed.

## How migrations work

Each schema change is a numbered SQL file in `src-tauri/migrations/`
(`0001_initial_schema.sql`, …), compiled into the app. On every start the
app applies any migrations the database has not yet seen, each in its own
transaction, and records them in the `schema_versions` table. If one fails,
it is rolled back, logged and reported on screen, and the app does not open
the half-updated database. A database made by a newer version is refused.
Released migration files are never edited; changes always go in a new file.

Before migrating, the app runs SQLite's integrity check and refuses to touch
a damaged database. When an existing database needs an upgrade, it first
writes a verified copy to `backups/pre-migration/`; if that fails, nothing
is changed.

## Brand assets

The Abiding Word name, logomark and brand assets are not covered by any
software licence in this repository. Fonts (Inter, Noto Serif) are SIL Open
Font License families, bundled into the built app from npm so it works
offline.
