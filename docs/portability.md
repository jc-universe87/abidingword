# Project files and backups (v0.19)

Abiding Word can move work between computers in two ways, each its own
action in **Settings › Data and backup**:

| Action | File | Holds | On import |
|---|---|---|---|
| Export project… / Import project… | `.awproject` | one project's own work | always a **new** project |
| Back up everything… / Restore from backup… | `.awbackup` | the whole database and `sources/` | replaces everything, after a safety copy |

"Export project…" is also in each project's **Info** panel.

The code is in `src-tauri/src/portability/`; the commands are in
`src-tauri/src/commands/portability.rs`. The tests in
`src-tauri/tests/portability.rs` run only on temporary data folders.

## Common to both formats

Both are ordinary `.zip` files. Each has a `manifest.json` that lists every
other entry with its `path`, `size` and `sha256`.

A file is read defensively, and nothing in it is ever run:

- **Entry names** must be plain relative paths: no absolute paths, no `..`, no
  backslashes, no drive letters, nothing outside the folders the format
  names. Every other name is refused.
- **Entries match the manifest exactly.** Every entry in the archive must be
  listed, and every listed entry must be present. Anything extra, missing or
  repeated means the file is not a package.
- **Sizes and hashes are checked while reading**, never trusted from the
  archive. A part that is longer than listed, or has another hash, makes the
  file damaged (`portability.damaged`).
- **Limits.** The number of entries, the size of each entry and the total are
  limited (`portability.tooLarge`).
- **Version.** A file from a newer format version, or with a newer database
  schema than this app's, is refused, and the person is asked to update first
  (`portability.newer`).
- **Unpacking** happens in a staging folder in `cache/`, which is removed
  afterwards whatever happens.
- **Writing** goes to a temporary file next to the target. That file is moved
  into place only when complete. A file the save dialog did not name is never
  replaced (its name plus the added extension).

## Project file (`.awproject`)

```text
manifest.json
project.json
files/teaching-images/<generated name>.png    (zero or more)
```

### `manifest.json`

| Field | Meaning |
|---|---|
| `format` | `"abiding-word-project"` |
| `formatVersion` | `1` |
| `schemaVersion` | database schema version it was saved with |
| `appVersion`, `createdAt` | for the person's information |
| `title`, `description` | the project's |
| `counts` | studies, teachings, presentations, notes, images |
| `external` | what the project refers to but the file does not hold, by id and name: `sources` (library), `presentationTemplates` (church templates), `bibles` |
| `missingImages` | kept images that were already missing when it was saved |
| `files` | every other entry: `path`, `size`, `sha256` |

### `project.json`

`{"tables": {"<table>": [ {column: value, …}, … ]}}`. These are the
project's own rows:

- the project;
- its studies with their parts, blocks, notes, tags, citations, passages and
  relations between its own studies;
- their teachings with steps, links, passages, materials, presentations and
  slides;
- the user study templates its studies were made from.

Deleted rows are left out, and so are rows that belong to deleted ones.

Values are plain JSON (text, number, null). Columns that hold JSON
(`details`, `data`, `sources`, `image`, `definition`) must hold readable
JSON.

**Never included:**

- library files;
- Bible texts;
- church templates;
- settings;
- API keys.

The person sees what the project refers to and this computer lacks, before
importing.

### Import

An import is one transaction: either all of it is there, or nothing is.

- **IDs.** Every row gets a new id, and every reference between rows follows
  it. Nothing in the package can point at, or overwrite, an existing row here.
  A row whose reference leads nowhere inside the package is left out.
- **Project.** It goes into this computer's workspace. Its title is free:
  "John (2)" when "John" exists.
- **Study templates.** A built-in template becomes this computer's own,
  matched by key. A person's own template is reused when an identical one is
  here; otherwise it is added under a new id.
- **Library citations** (v0.19.1). No citation is lost because its book is
  not on this computer. Each one ends in exactly one of three states, never
  by a guess:
  1. **Linked.** The same source is here, by id. If it has since been removed
     from this library, the citation says *removed from library*, just like
     a citation made here.
  2. **Reconnected.** Exactly the same file is here under another id (the
     same SHA-256 as `sources.content_hash`, from one live source only). The
     citation points at it. The other computer's paragraph and mark ids are
     dropped; the citation's words find their place again when it is opened.
  3. **Kept, not on this computer.** `source_id` is empty, and the
     citation's snapshot stays:
     - title and author;
     - the quoted words, page or location, section and anchor;
     - `cited_source_id` (the source's id where it was made);
     - `cited_content_hash` (that file's hash).

     The Study shows it as *(not on this computer)*, with "Source not
     available on this computer. The citation has been kept." for screen
     readers and as a tooltip. Nothing can be opened, and no placeholder
     source is ever made.

  **Invalid citations.** A citation row whose values are not text makes the
  package invalid. A row that names nothing at all (no source here, no title
  in the row and none in the manifest) is left out and counted as
  unreadable. An anchor that is not readable JSON is dropped; the rest of the
  citation stays.

  **On export,** every citation is completed from its source when that is
  here: title, author, `cited_source_id` and `cited_content_hash`. So a
  citation survives any number of moves unchanged.

  **The manifest** lists every cited source, including ones already kept
  without their source, with its file hash.

  **Later reconnection.** Adding exactly that file to the library later
  (`db::library::reconnect_citations`, run inside the library import)
  points kept citations at it again. Nothing is ever matched by title.
- **Presentations.** A church template or Bible that is not here becomes
  empty: the standard design, no Bible text.
- **Slides.** A slide made from a step or note follows it to the new id.
- **Images.** They are checked into staging and copied into
  `sources/teaching-images/` under new names. They are moved into place
  just before the transaction commits, and removed again if it fails.
- **Checks.** Column names must be columns of this app's tables, so the
  package's names never become SQL. The database's own checks apply to every
  insert, and `PRAGMA foreign_key_check` must find no broken reference the
  import made. References that were already broken on this computer (rows
  left from long ago) are not the import's and do not refuse it (v0.19.1).

## Backup (`.awbackup`)

```text
manifest.json
database.db
files/<n>                                     (one per file in sources/)
```

`manifest.json` has:

- `format` (`"abiding-word-backup"`) and `formatVersion` (`1`);
- `schemaVersion`, `appVersion` and `createdAt`;
- `counts`;
- `places`, mapping each `files/<n>` to its path under the data folder, which
  must stay inside `sources/` and be a valid file name on every system;
- `files`.

### What is in it

- **The database** is a consistent snapshot made with `VACUUM INTO`, which
  includes changes still in the WAL file. It is never a copy of the live
  file. The snapshot is verified (integrity, schema version) before it is
  packed.
- **Every file in `sources/`:**
  - library files;
  - imported Bibles' source files;
  - kept generated images;
  - offline copies of found images;
  - church templates' images.

Links are not followed. A file whose name another system could not hold is
left out and logged.

### What is never in it

- API keys, tokens or passwords. They live only in the operating system's
  credential store, never in the database or the data folder. A test checks
  the snapshot's settings table.
- `cache/`, `logs/`, earlier backups and exports.

It is a private copy for the person themselves. It can hold books and Bibles
whose licences allow a personal copy but not passing them on, and the
interface says so.

### Restore

1. **Preflight.**
   - The manifest, names and places are checked.
   - Every part is unpacked into staging and checked against its hash.
   - The backup's database is checked on its own: it opens, passes
     `integrity_check`, has Abiding Word's tables, and its schema is not
     newer.
   - Nothing has changed yet.
2. **Safety copy.** The current database is copied with `VACUUM INTO` to
   `backups/pre-restore/` and the copy is verified.
3. **Replace.** SQLite's backup API copies the backup's database into the
   open connection. Then come the same steps as at every start: integrity,
   migrations (with their own pre-migration backup), the default workspace
   and built-in templates. If any step fails, the safety copy is copied
   back the same way, and the person is told nothing was changed
   (`portability.restoreFailed`). Should even that fail, the error says
   where the safety copy is (`portability.rollbackFailed`).
4. **Files** are added to `sources/`. A file already there with the same
   content is left alone. A file that differs is moved to
   `backups/pre-restore/files-<time>/`, never deleted.
5. **Reload.** The interface reloads, because everything it shows may have
   changed.

API keys are not touched, so a restore on another computer asks for them
again.

## Known limits

- A project file does not carry library books, Bible texts or church
  templates, by design: they are named, and the person is told which are
  missing. Citations of a missing book are kept with what they said (see
  above), but cannot be opened until that exact file is added. There is no
  manual "link to another book" yet: a different edition or file is never
  joined to a citation.
- Offline copies of found images are not in a project file. Presenting
  fetches them again, or shows the image's address.
- Restoring holds the database for its duration. On a large library this
  takes a while, and the interface shows that it is working.
- Restoring a backup made with an older version upgrades it with the normal
  migrations. A backup from a newer version is refused.
