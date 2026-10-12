# Abiding Word — developer guide

This is the technical companion to the [User Guide](guide/README.md): how to
build, test and release Abiding Word, and how the code is organised. Standing
rules for automated contributors are in [`CLAUDE.md`](../CLAUDE.md); the
release channel is described in [`updates.md`](updates.md).

## Architecture in brief

- **Tauri 2** desktop shell (no Electron). The installed app needs no other
  runtime.
- **React + TypeScript + Vite + Tailwind CSS** for the interface (`src/`).
- **Rust** native core (`src-tauri/`) owns the data folder, the SQLite
  database, migrations, logging and errors.
- The interface talks to the core only through typed Tauri commands
  (`project_create`, `study_get`, …). No SQL crosses that boundary.

The authoritative baseline is the frozen
[`concept.md`](concept.md) and
[`architecture.md`](architecture.md). How this release implements
it: [`docs/foundation-v0.1.md`](foundation-v0.1.md),
[`docs/scripture-v0.2.md`](scripture-v0.2.md),
[`docs/studies-v0.3.md`](studies-v0.3.md) and
[`docs/library-v0.4.md`](library-v0.4.md). After v0.4 (on the v0.5 branch):
[`docs/scripture-annotations-v0.5.md`](scripture-annotations-v0.5.md),
[`docs/formatted-source-viewer.md`](formatted-source-viewer.md) and, for
what is deliberately not built yet, [`docs/product-backlog.md`](product-backlog.md).

## Milestones

| Milestone | State | What it added |
|---|---|---|
| Foundation v0.1 | complete, frozen | shell, data folder, migrations, integrity check, pre-migration backup |
| Scripture v0.2 | complete | canon, references, reader, Bible import, annotations, search |
| Studies v0.3 | complete (tag `studies-v0.3`) | study types, findings, templates, relations, study search |
| Library v0.4 | complete (tag `library-v0.4`) | PDF/EPUB/Markdown/text import, provenance, library search, passage mentions, finding citations |
| Scripture annotations v0.5 | complete (tag `scripture-annotations-v0.5`) | verse and phrase highlights in five colours, notes, bookmarks, the annotation inspector, the Marks view; PDF Original view and Contents |
| Study workspace UX v0.6 | complete (tag `study-workspace-ux-v0.6`) | "What would you like to study?" and a simpler study screen (progressive disclosure) |
| Source navigation v0.7 | complete (tag `source-navigation-v0.7`) | internal links and footnotes in PDF and EPUB sources, with Back / Forward |
| Formatted sources v0.8 | complete (tag `formatted-sources-v0.8`) | formatted EPUB and DOCX Original views, DOCX import, Reading ↔ Original mapping, web links in the system browser |
| Passage-aware sources v0.9 | complete (tag `passage-aware-sources-v0.9`) | sources grouped by passage with the reason for each place; section links from headings; aboutness-aware ranking |
| Study workspace refinement v0.10 | complete (tag `study-workspace-refinement-v0.10`) | default project, quieter header, one Add, simpler capture, findings in their sections, pane-aware layout |
| Scripture links v0.11 | complete (tag `scripture-links-v0.11`); German "Mal" fix merged afterwards (`76145c3`, test build `0.5.0-dev.26`) | references in sources open in the Bible; Scripture Back / Forward and Back to the Study's passage; PDF Original not linked (intentional) |
| Concordance v0.12 | accepted on Windows; merged (`75fe193`); to be tagged `concordance-v0.12` at `76145c3` (last `main` before v0.13, test build `0.5.0-dev.26`) | word and phrase occurrences in one Bible, by book; Find occurrences from a word study; surface forms only |
| Library reading & interactive PDF v0.13 (with v0.13.1, v0.13.2) | accepted on Windows (`0.5.0-dev.29`); to be tagged `library-reading-v0.13` at `2732029` | Find in this source; generated contents when a source has none; EPUB character references; Scripture references, find marks and a no-text notice on Original PDF pages; view remembered per source; v0.13.1: references without a book name in context, folding contents, EPUB text repair; v0.13.2: references in any supported language, heading lines as context |
| Document annotations & source notes v0.14 | built on branch `claude/beautiful-curie-vm0eve`; not merged, not tagged, no Windows build yet | highlights, notes and bookmarks in library sources, anchored in the stored text; drawn in Reading, on Original PDF pages and in formatted EPUB/DOCX; made in Reading and on PDF pages; Marks for Bible and sources together; migration 0006 |

The detailed record of each milestone is listed in the [documentation map](README.md).

## Supported platforms

Desktop first: **Linux**, **Windows** and **macOS** (Tauri 2). Development
and the release builds so far have been done on Debian-family Linux; the
code has no Linux-only parts, but Windows and macOS builds have not been
verified yet. A Chromebook works through its Linux development environment,
which is Debian-based, so the Linux instructions below apply there too.

## Building and running from source

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
git clone https://github.com/jc-universe87/abidingword.git
cd abidingword
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
- **Windows test updates.** Every `main` commit whose CI passes is
  automatically published as a signed Development/Test build that an
  installed test build of Abiding Word offers (Settings → Updates, plus a
  notice after startup). Feature branches and pull requests never publish;
  stable releases are never automatic. See
  [`docs/updates.md`](updates.md) for the trigger, the channel, the
  one-time key setup and the version scheme.

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
string: [`docs/i18n.md`](i18n.md).

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

## Refreshing the user guide screenshots

The pictures in [`docs/guide/images/`](guide/images/) are taken from the real
interface by a small harness in [`tests/screenshots/`](../tests/screenshots/):
the app runs in a browser against the in-memory API used by the interface
tests, seeded with sample studies and library items written for the guide and
with the public-domain World English Bible from `resources/scripture/`.
Nothing in the harness ships with the app.

```sh
npm i --no-save playwright && npx playwright install chromium   # once
node tests/screenshots/web-text.mjs /tmp/aw-shots/web.json
SCREENSHOT_DATA=/tmp/aw-shots npx vite --config tests/screenshots/vite.config.ts &
node tests/screenshots/capture.mjs            # all scenes, or name some: capture.mjs marks concordance
```

Retake them when the interface changes visibly, and check every image before
committing it.

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
