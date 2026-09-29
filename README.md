# Abiding Word

**Bible Study Workspace** — *Study with diligence. Teach with love.*

Abiding Word is a local-first desktop application for serious Bible study.
It runs entirely on your own computer: no server, no account, no internet
connection needed. Your studies are stored in one folder that you own.

The workflow it is built around: **Word → Understanding → Teaching**.

## Status: Foundation v0.1

This is the foundation release. It provides:

- a three-pane workspace: **Scripture | Study | Sources**
- projects that group studies (e.g. *Romans Sermon Series*)
- studies created from a passage-study template with nine sections
  (Text, Context, Observations, Structure, Exegesis, Theology, Application,
  Audience, Teaching)
- simple editing with paragraph, note and heading blocks, saved automatically
- a local SQLite database with versioned migrations
- settings showing the version and data folder, and a light/dark theme

**Not in this release, planned for later phases:** the Scripture engine,
source import and the personal library, concordance and original-language
tools, AI assistance, sync, integrations and MCP. The Scripture and Sources
panes show placeholders until then.

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
it: [`docs/foundation-v0.1.md`](docs/foundation-v0.1.md).

## Development prerequisites

- **Node.js 20.19+** with **npm 10+**. (Debian's packaged npm 9.2 fails to
  install these dependencies; run `npx -y npm@10 install` instead, or use a
  newer Node.js.)
- **Rust** (stable, 1.82+) via [rustup](https://rustup.rs).
- Platform libraries for Tauri — see
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On
  Debian/Ubuntu:

  ```sh
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

## Commands

| Task | Command |
|---|---|
| Install dependencies | `npm install` |
| Run the desktop app in development | `npm run tauri dev` |
| Build installers for this platform | `npm run tauri build` |
| Interface tests | `npm test` |
| Native (Rust) tests | `npm run test:rust` |
| Type check | `npm run typecheck` |
| Lint (TypeScript) | `npm run lint` |
| Lint (Rust, warnings are errors) | `npm run lint:rust` |
| Everything above except build | `npm run check` |

Build output lands in `src-tauri/target/release/bundle/`.

To develop without touching your real studies, point the app at a scratch
folder:

```sh
ABIDING_WORD_DATA_DIR=/tmp/aw-dev npm run tauri dev
```

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
  templates/          study templates (JSON)
  scripture/          Bible texts (empty until the Scripture engine)
  icons/              brand source icons
docs/                 concept and architecture
tests/                interface tests and test support
```

## Where your data is stored

| OS | Folder |
|---|---|
| Linux | `~/.local/share/Abiding Word/` |
| macOS | `~/Library/Application Support/Abiding Word/` |
| Windows | `%APPDATA%\Abiding Word\` |

Inside: `database/abiding-word.db` (all studies), `logs/`, and folders
reserved for later phases (`sources/`, `indexes/`, `cache/`, `sync/`,
`backups/`, `exports/`). The exact path is shown in **Settings**.
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
software licence in this repository. Fonts (Inter, Noto Serif Display,
Noto Serif) are SIL Open Font License families, bundled into the built app
from npm so it works offline.
