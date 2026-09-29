-- Abiding Word — migration 0001: initial schema (Foundation v0.1)
--
-- Conventions (see docs/foundation-v0.1.md, "Database"):
--   * Primary keys are UUID v4 strings.
--   * Timestamps are UTC ISO-8601 strings with millisecond precision,
--     written by the application, e.g. 2026-09-29T08:15:02.123Z.
--   * Every major record carries created_at, updated_at, deleted_at (soft
--     delete: NULL means live) and revision (starts at 1, +1 on every update).
--   * JSON columns hold type-specific detail that is expected to evolve.
--
-- The migration runner wraps this file in a transaction and records it in
-- schema_versions. Never edit this file after release: add a new migration.

-- ---------------------------------------------------------------------------
-- Workspace → Project → Study → StudySection → StudyBlock
-- ---------------------------------------------------------------------------

CREATE TABLE workspaces (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    revision    INTEGER NOT NULL DEFAULT 1
);

-- At most one live default workspace.
CREATE UNIQUE INDEX workspaces_one_default
    ON workspaces (is_default) WHERE is_default = 1 AND deleted_at IS NULL;

CREATE TABLE projects (
    id            TEXT PRIMARY KEY NOT NULL,
    workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT,
    revision      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX projects_workspace ON projects (workspace_id);

-- Templates describe which sections a new study starts with. Built-in
-- templates are installed from resources/templates at startup.
CREATE TABLE study_templates (
    id           TEXT PRIMARY KEY NOT NULL,
    key          TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT,
    is_builtin   INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    -- JSON: {"sections": [{"key": "...", "title": "...", "guidance": "..."}]}
    definition   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    revision     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE studies (
    id           TEXT PRIMARY KEY NOT NULL,
    project_id   TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    -- Which template the study was created from. Sections are copied at
    -- creation, so later template changes never alter an existing study.
    template_id  TEXT REFERENCES study_templates (id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    revision     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX studies_project ON studies (project_id);

CREATE TABLE study_sections (
    id          TEXT PRIMARY KEY NOT NULL,
    study_id    TEXT NOT NULL REFERENCES studies (id) ON DELETE CASCADE,
    -- Stable machine key from the template (e.g. "observations"); NULL for
    -- sections the user adds later.
    key         TEXT,
    title       TEXT NOT NULL,
    guidance    TEXT,
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    revision    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX study_sections_study ON study_sections (study_id, position);

CREATE TABLE study_blocks (
    id          TEXT PRIMARY KEY NOT NULL,
    section_id  TEXT NOT NULL REFERENCES study_sections (id) ON DELETE CASCADE,
    -- Validated by the application, not by CHECK, so new block types
    -- (quotation, word_study, source_citation, ...) need no table rebuild.
    block_type  TEXT NOT NULL,
    position    INTEGER NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    -- JSON: type-specific attributes for future block types.
    data        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    revision    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX study_blocks_section ON study_blocks (section_id, position);

-- ---------------------------------------------------------------------------
-- Study findings, Scripture references and annotations (structure only in
-- v0.1; no user interface yet).
-- ---------------------------------------------------------------------------

CREATE TABLE findings (
    id          TEXT PRIMARY KEY NOT NULL,
    study_id    TEXT NOT NULL REFERENCES studies (id) ON DELETE CASCADE,
    section_id  TEXT REFERENCES study_sections (id) ON DELETE SET NULL,
    -- e.g. observation, interpretation, application, question
    kind        TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    data        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    revision    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX findings_study ON findings (study_id);

-- A reference to a Scripture range. `book` is the canonical three-letter
-- book code used in canonical IDs such as ROM.8.1 and JHN.15.7
-- (docs/architecture.md §6), independent of any translation.
-- Each reference belongs to exactly one owner: a study, a block or a finding.
CREATE TABLE passage_references (
    id             TEXT PRIMARY KEY NOT NULL,
    study_id       TEXT REFERENCES studies (id) ON DELETE CASCADE,
    block_id       TEXT REFERENCES study_blocks (id) ON DELETE CASCADE,
    finding_id     TEXT REFERENCES findings (id) ON DELETE CASCADE,
    book           TEXT NOT NULL,
    start_chapter  INTEGER NOT NULL CHECK (start_chapter >= 1),
    start_verse    INTEGER CHECK (start_verse >= 1),
    end_chapter    INTEGER CHECK (end_chapter >= 1),
    end_verse      INTEGER CHECK (end_verse >= 1),
    -- The reference as the user typed or saw it, e.g. "Romans 8:1–17".
    label          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    revision       INTEGER NOT NULL DEFAULT 1,
    CHECK ((study_id IS NOT NULL) + (block_id IS NOT NULL) + (finding_id IS NOT NULL) = 1)
);

CREATE INDEX passage_references_study ON passage_references (study_id);
CREATE INDEX passage_references_block ON passage_references (block_id);
CREATE INDEX passage_references_finding ON passage_references (finding_id);
CREATE INDEX passage_references_book ON passage_references (book, start_chapter);

-- ---------------------------------------------------------------------------
-- Personal source library (structure only in v0.1; no import yet).
-- ---------------------------------------------------------------------------

CREATE TABLE sources (
    id            TEXT PRIMARY KEY NOT NULL,
    workspace_id  TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- e.g. commentary, book, article, sermon, lecture, note
    source_type   TEXT NOT NULL,
    title         TEXT NOT NULL,
    author        TEXT,
    citation      TEXT,
    data          TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT,
    revision      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX sources_workspace ON sources (workspace_id);

CREATE TABLE source_files (
    id             TEXT PRIMARY KEY NOT NULL,
    source_id      TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    -- Relative to the data directory's sources/ folder, never absolute, so
    -- the whole data directory can be moved or backed up as one unit.
    relative_path  TEXT NOT NULL,
    media_type     TEXT,
    size_bytes     INTEGER,
    sha256         TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    revision       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX source_files_source ON source_files (source_id);

CREATE TABLE source_segments (
    id              TEXT PRIMARY KEY NOT NULL,
    source_id       TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    source_file_id  TEXT REFERENCES source_files (id) ON DELETE SET NULL,
    position        INTEGER NOT NULL,
    -- Where the segment sits in the original, e.g. "p. 214" or "ch. 3 §2".
    locator         TEXT,
    content         TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    revision        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX source_segments_source ON source_segments (source_id, position);

-- A user note anchored to a Scripture reference or to a source segment.
CREATE TABLE annotations (
    id                    TEXT PRIMARY KEY NOT NULL,
    workspace_id          TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    passage_reference_id  TEXT REFERENCES passage_references (id) ON DELETE CASCADE,
    source_segment_id     TEXT REFERENCES source_segments (id) ON DELETE CASCADE,
    kind                  TEXT NOT NULL DEFAULT 'note',
    content               TEXT NOT NULL DEFAULT '',
    data                  TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted_at            TEXT,
    revision              INTEGER NOT NULL DEFAULT 1,
    CHECK ((passage_reference_id IS NOT NULL) + (source_segment_id IS NOT NULL) = 1)
);

CREATE INDEX annotations_passage ON annotations (passage_reference_id);
CREATE INDEX annotations_segment ON annotations (source_segment_id);

-- ---------------------------------------------------------------------------
-- Settings: one row per key. The key is the identity; the value is JSON.
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
    key         TEXT PRIMARY KEY NOT NULL,
    value       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
