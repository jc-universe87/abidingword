# Abiding Word — Architecture

> **Stand-in document.** The frozen architecture document named in the
> Foundation v0.1 brief was not available when this repository was created.
> This file records the architecture as built in Foundation v0.1. **Replace
> or reconcile it with the frozen document** when it is supplied. Where the
> two differ, the frozen document wins and the code should follow it.

## Overview

```text
┌────────────────────────────── Tauri window ──────────────────────────────┐
│  React + TypeScript UI (src/)                                            │
│    features/ → hooks/ → lib/api.ts  ── invoke("project_create", …) ──┐   │
└──────────────────────────────────────────────────────────────────────┼───┘
                                                                       ▼
┌──────────────────────── Rust native core (src-tauri/src/) ───────────────┐
│  commands/  typed commands, thin                                         │
│      ▼                                                                   │
│  db/        repositories (plain functions over a SQLite connection)      │
│      ▼                                                                   │
│  SQLite file in the user's data folder  ◄── migrations/ (versioned SQL)  │
│                                                                          │
│  filesystem/  data folder   error.rs  one error model   state.rs startup │
└──────────────────────────────────────────────────────────────────────────┘
```

There is no server and no network access. The frontend never sees SQL or
file paths it could write to; it can only call the typed commands.

## Frontend (`src/`)

| Folder | Holds |
|---|---|
| `app/` | Startup (`App.tsx`), the shell, startup and crash screens |
| `layouts/` | App bar and the three-pane workspace layout |
| `features/scripture/` | Scripture pane (placeholder in v0.1) |
| `features/studies/` | Projects, studies, sections and block editing |
| `features/library/` | Sources pane (placeholder in v0.1) |
| `features/settings/` | Settings view and theme |
| `features/ai/` | Empty on purpose (later phase) |
| `design-system/` | Brand tokens, base styles, shared UI parts |
| `hooks/` | Data loading, autosave, save status |
| `lib/` | The API boundary (`api.ts`) and local preferences |
| `types/` | TypeScript mirror of the native domain types |

Components reach the native core only through the `Api` interface
(`useApi()`), never through `invoke` directly. Tests substitute an in-memory
implementation (`tests/support/memoryApi.ts`).

Editing is plain text areas that save themselves 0.5 s after typing stops,
and at once when a field is left. Saves for one field run strictly in order.

## Native core (`src-tauri/src/`)

| Module | Role |
|---|---|
| `lib.rs` | Builds the Tauri app, registers commands, starts logging |
| `state.rs` | Opens the data folder and database; keeps a startup failure for the UI |
| `filesystem/` | The data folder and its subfolders |
| `db/` | Connection, migrations, one repository per table group |
| `domain/` | Records, command inputs, validation |
| `commands/` | Typed Tauri commands |
| `error.rs` | `AppError` (for the log) → `ErrorPayload` (for the user) |
| `integrations/` | Empty extension boundary for later phases |

Commands run on a background thread pool (`#[tauri::command(async)]`), so
database work never blocks the window. One SQLite connection sits behind a
mutex; this is ample for a single-user desktop app.

### Commands

| Area | Commands |
|---|---|
| App | `app_info`, `app_log_error` |
| Workspace | `workspace_get_default` |
| Projects | `project_list`, `project_get`, `project_create`, `project_update` |
| Studies | `study_list`, `study_get`, `study_create`, `study_update` |
| Sections | `study_section_list`, `study_section_update` |
| Blocks | `study_block_create`, `study_block_update`, `study_block_delete` |
| Settings | `settings_get`, `settings_update` |

Inputs and outputs are typed structs, serialised with camelCase names.

## Data folder

Resolved through Tauri's per-user data directory plus `Abiding Word/`:

| OS | Location |
|---|---|
| Linux | `~/.local/share/Abiding Word/` (or `$XDG_DATA_HOME`) |
| macOS | `~/Library/Application Support/Abiding Word/` |
| Windows | `%APPDATA%\Abiding Word\` |

Subfolders: `database/`, `sources/`, `indexes/`, `cache/`, `sync/`,
`backups/`, `exports/`, `logs/`. Setting `ABIDING_WORD_DATA_DIR` points the
app at a different folder (for development and testing).

## Database

- Every major record: UUID `id`, `created_at`, `updated_at`, `deleted_at`
  (soft delete), `revision` (+1 per update). Timestamps are UTC ISO-8601.
- Tables: `workspaces`, `projects`, `studies`, `study_sections`,
  `study_blocks`, `findings`, `passage_references`, `annotations`,
  `sources`, `source_files`, `source_segments`, `study_templates`,
  `settings`, `schema_versions`.
- Hierarchy: Workspace → Project → Study → StudySection → StudyBlock.
- Block types are validated in Rust, not by a CHECK constraint, so new types
  need no table rebuild.
- `passage_references` store OSIS book codes and chapter/verse ranges, ready
  for the Scripture engine.
- Source file paths are stored relative to the data folder, so the folder
  can be moved or backed up as a whole.
- Pragmas: `foreign_keys = ON`, `journal_mode = WAL`.

### Migrations

1. SQL files in `src-tauri/migrations/`, numbered `0001_…`, compiled into
   the app and listed in `db/migrations.rs`.
2. On every startup, migrations newer than the highest version in
   `schema_versions` run in order, each in its own transaction with its
   `schema_versions` row. A failure rolls that migration back, is logged,
   and is shown to the user; the app does not continue on a half-migrated
   database.
3. A database from a newer app version is refused.
4. Released migrations are never edited.

### Templates

Built-in study templates are JSON files in `resources/templates/`, compiled
in and installed on startup. A new study copies its template's sections, so
changing a template never alters existing studies.

## Errors and logging

`AppError` distinguishes database, filesystem, invalid input, not found,
migration and unexpected errors. Commands return `ErrorPayload
{ kind, message }`, where `message` is a short sentence for the user; the
technical detail goes to the log. Panics are logged; the UI shows a plain
message and never Rust panic output.

Logs go to `logs/` in the data folder (or the OS log folder if the data
folder is unusable): startup, data folder, database path, migration status,
failures. Study content is never logged. Files rotate at 2 MB, keeping 5.

## Theme and accessibility

Brand tokens (`design-system/tokens.css`) define light and dark themes;
Tailwind utilities read those tokens. The theme (light, dark, match system)
is stored in the database. All controls are keyboard reachable with a
visible brass focus ring; panes are landmarks; pane dividers follow the
WAI-ARIA window-splitter pattern; body text is 16–18 px.

## Extension points

| Later feature | Where it plugs in |
|---|---|
| Scripture engine | `features/scripture/`, texts in `resources/scripture/`, `passage_references` |
| Source library | `features/library/`, `sources*` tables, `sources/` folder |
| New block types | `BlockType` in Rust and TypeScript plus an editor component |
| Templates | JSON in `resources/templates/` |
| Search | `indexes/` folder |
| AI, sync, MCP, integrations | `src-tauri/src/integrations/`, `features/ai/`; always optional |
