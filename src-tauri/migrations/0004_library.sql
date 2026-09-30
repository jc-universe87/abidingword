-- Abiding Word — migration 0004: Library (Library v0.4)
--
-- Extends the source tables from 0001 (sources, source_files,
-- source_segments) into a working personal library: bibliographic metadata,
-- licence status, managed files with content hashes and extraction status,
-- segments with exact provenance (page, chapter, section, paragraph),
-- links from segments to canonical Scripture, full-text search, and
-- citation snapshots on finding_sources. Details: docs/library-v0.4.md.

-- ---------------------------------------------------------------------------
-- Sources: bibliographic metadata and licence status.
-- A removed source keeps its row (deleted_at set) as a citation tombstone:
-- findings that cited it can still say what they cited.
-- ---------------------------------------------------------------------------

ALTER TABLE sources ADD COLUMN subtitle TEXT;
ALTER TABLE sources ADD COLUMN publisher TEXT;
ALTER TABLE sources ADD COLUMN edition TEXT;
ALTER TABLE sources ADD COLUMN publication_year INTEGER;
ALTER TABLE sources ADD COLUMN isbn TEXT;
ALTER TABLE sources ADD COLUMN doi TEXT;
ALTER TABLE sources ADD COLUMN language TEXT;
-- private: the user's own copy, never to be redistributed (the default);
-- distributable: licence allows sharing; unknown: not stated.
ALTER TABLE sources ADD COLUMN licence_status TEXT NOT NULL DEFAULT 'private'
    CHECK (licence_status IN ('private', 'distributable', 'unknown'));
ALTER TABLE sources ADD COLUMN licence TEXT;
ALTER TABLE sources ADD COLUMN notes TEXT;
-- SHA-256 of the primary file at import, kept after removal so a future
-- re-import can be recognised (docs/library-v0.4.md, "Future").
ALTER TABLE sources ADD COLUMN content_hash TEXT;

CREATE INDEX sources_live ON sources (workspace_id, source_type) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Source files: the managed copy. One primary file per source in v0.4; the
-- table already allows several (future versions or formats).
-- ---------------------------------------------------------------------------

ALTER TABLE source_files ADD COLUMN format TEXT;            -- pdf, epub, markdown, text
ALTER TABLE source_files ADD COLUMN original_filename TEXT; -- as the user had it
ALTER TABLE source_files ADD COLUMN original_path TEXT;     -- where it was imported from (informational)
ALTER TABLE source_files ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1));
-- digital_text: born-digital text (EPUB, Markdown, text);
-- extracted_text: text extracted from a layout format (PDF);
-- ocr_required: no usable text layer (scanned); ocr_text, user_corrected:
-- reserved for OCR and correction (not produced in v0.4).
ALTER TABLE source_files ADD COLUMN extraction_status TEXT
    CHECK (extraction_status IS NULL OR extraction_status IN
           ('digital_text', 'extracted_text', 'ocr_required', 'ocr_text', 'user_corrected'));
ALTER TABLE source_files ADD COLUMN page_count INTEGER;

CREATE INDEX source_files_hash ON source_files (sha256) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Source segments, rebuilt with a stable integer key.
--
-- The full-text index needs an integer key that never changes; the 0001
-- table had only a text id (its implicit rowid may be renumbered by
-- VACUUM). `seq` is an explicit INTEGER PRIMARY KEY; `id` stays the UUID
-- used by findings, links and future deep links. Rows are copied.
-- ---------------------------------------------------------------------------

CREATE TABLE source_segments_v4 (
    seq                INTEGER PRIMARY KEY,
    id                 TEXT NOT NULL UNIQUE,
    source_id          TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    source_file_id     TEXT REFERENCES source_files (id) ON DELETE SET NULL,
    position           INTEGER NOT NULL,
    content            TEXT NOT NULL DEFAULT '',
    -- Provenance. Only what the format really supplies is filled in:
    -- PDFs have pages, EPUBs chapters and sections, Markdown headings.
    page_number        INTEGER,
    page_label         TEXT,
    chapter            TEXT,
    heading            TEXT,
    section_path       TEXT,       -- e.g. "Chapter 3 › The Cross"
    paragraph_index    INTEGER,    -- within its page / chapter / section
    char_start         INTEGER,    -- offsets in the extracted text of its page or document
    char_end           INTEGER,
    -- Human-readable location, e.g. "p. 152", "Chapter 3 › Grace".
    locator            TEXT,
    extraction_status  TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT,
    revision           INTEGER NOT NULL DEFAULT 1
);

INSERT INTO source_segments_v4
    (id, source_id, source_file_id, position, content, locator, created_at, updated_at,
     deleted_at, revision)
SELECT id, source_id, source_file_id, position, content, locator, created_at, updated_at,
       deleted_at, revision
FROM source_segments;

DROP TABLE source_segments;
ALTER TABLE source_segments_v4 RENAME TO source_segments;

CREATE INDEX source_segments_source ON source_segments (source_id, position);

-- Full-text search over segment text (external content, stable seq key).
CREATE VIRTUAL TABLE library_search USING fts5 (
    content,
    content = 'source_segments',
    content_rowid = 'seq',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER library_search_ai AFTER INSERT ON source_segments BEGIN
    INSERT INTO library_search (rowid, content) VALUES (new.seq, new.content);
END;

CREATE TRIGGER library_search_ad AFTER DELETE ON source_segments BEGIN
    INSERT INTO library_search (library_search, rowid, content) VALUES ('delete', old.seq, old.content);
END;

CREATE TRIGGER library_search_au AFTER UPDATE OF content ON source_segments BEGIN
    INSERT INTO library_search (library_search, rowid, content) VALUES ('delete', old.seq, old.content);
    INSERT INTO library_search (rowid, content) VALUES (new.seq, new.content);
END;

INSERT INTO library_search (rowid, content) SELECT seq, content FROM source_segments;

-- ---------------------------------------------------------------------------
-- Segment ↔ canonical Scripture, found by the deterministic reference
-- detector at import. Removed with their segment.
-- ---------------------------------------------------------------------------

CREATE TABLE source_passages (
    id            TEXT PRIMARY KEY NOT NULL,
    source_id     TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    segment_id    TEXT NOT NULL REFERENCES source_segments (id) ON DELETE CASCADE,
    passage       TEXT NOT NULL,        -- canonical, e.g. ROM.8.1-ROM.8.4
    start_key     INTEGER NOT NULL,     -- verse-key range for lookup
    end_key       INTEGER NOT NULL,
    matched_text  TEXT NOT NULL,        -- as written in the source, e.g. "Rom 8:1-4"
    start_offset  INTEGER,              -- within the segment (UTF-16 units)
    end_offset    INTEGER,
    created_at    TEXT NOT NULL,
    CHECK (end_key >= start_key)
);

CREATE INDEX source_passages_range ON source_passages (start_key, end_key);
CREATE INDEX source_passages_segment ON source_passages (segment_id);
CREATE INDEX source_passages_source ON source_passages (source_id);

-- ---------------------------------------------------------------------------
-- Finding citations (table from 0003): a snapshot of what was cited, so a
-- citation still reads correctly after its source is removed. The segment
-- link is cleared on removal (segment deleted); source_id keeps pointing at
-- the tombstoned source row.
-- ---------------------------------------------------------------------------

ALTER TABLE finding_sources ADD COLUMN cited_title TEXT;
ALTER TABLE finding_sources ADD COLUMN cited_author TEXT;
