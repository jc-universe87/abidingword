-- Abiding Word — migration 0006: source annotations (v0.14)
--
-- Highlights, notes and bookmarks a person makes in a library source. They
-- belong to the source document, not to canonical Scripture: Scripture
-- annotations (`annotations`, 0002) are untouched and stay separate.
-- Details: docs/source-annotations-v0.14.md.
--
-- Identity lives in the stored source text, never in a view: the segments
-- and UTF-16 offsets the selection covers, the exact words (`quote`) and the
-- text just before and after them. Views (Reading, Original PDF, formatted
-- EPUB/DOCX) find the words again each time they draw; no screen rectangle
-- or zoom level is stored. When the stored text changes (an EPUB text
-- repair), the anchor is found again from the quote and its context, or the
-- annotation is kept as "unresolved" — never moved to other words.
--
-- `annotations.source_segment_id` (0001/0002) was never used by the
-- application and is superseded by this table; rows that may carry it are
-- copied below as notes on that paragraph, and the column is left alone.

CREATE TABLE source_annotations (
    id                TEXT PRIMARY KEY NOT NULL,
    workspace_id      TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- Sources are never hard-deleted (a removed one is a tombstone); its
    -- annotations are soft-deleted with it.
    source_id         TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    source_file_id    TEXT REFERENCES source_files (id) ON DELETE SET NULL,
    -- highlight, note, bookmark (validated by the application, so later kinds
    -- need no table rebuild).
    kind              TEXT NOT NULL,
    color             TEXT,                 -- highlights only
    content           TEXT NOT NULL DEFAULT '',  -- a note's words
    -- The durable anchor: segments and UTF-16 offsets into their stored text
    -- (end exclusive). A place (bookmark, note on a paragraph) has a start
    -- segment and no offsets. Segments that disappear leave NULL here; the
    -- quote and context below still say where the annotation belongs.
    start_segment_id  TEXT REFERENCES source_segments (id) ON DELETE SET NULL,
    start_offset      INTEGER,
    end_segment_id    TEXT REFERENCES source_segments (id) ON DELETE SET NULL,
    end_offset        INTEGER,
    -- The selected stored text; segments are joined with "\n".
    quote             TEXT,
    prefix            TEXT,
    suffix            TEXT,
    -- Snapshots of where it was, for order and as a fallback, never the
    -- identity.
    position          INTEGER,
    page_number       INTEGER,
    locator           TEXT,
    section_path      TEXT,
    -- Small format-specific placement details (JSON, versioned), e.g. the
    -- page and height share of a bookmark made on an Original PDF page.
    anchor            TEXT,
    -- exact: found where it was stored; moved: found again after the text
    -- changed; unresolved: not found without guessing.
    anchor_state      TEXT NOT NULL DEFAULT 'exact'
                      CHECK (anchor_state IN ('exact', 'moved', 'unresolved')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT,
    revision          INTEGER NOT NULL DEFAULT 1,
    CHECK ((start_offset IS NULL) = (end_offset IS NULL)),
    CHECK ((start_offset IS NULL) = (quote IS NULL)),
    CHECK (start_offset IS NULL OR start_offset >= 0),
    CHECK (end_offset IS NULL OR end_offset >= 0)
);

CREATE INDEX source_annotations_source
    ON source_annotations (source_id, position) WHERE deleted_at IS NULL;
CREATE INDEX source_annotations_kind
    ON source_annotations (kind, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX source_annotations_start ON source_annotations (start_segment_id);
CREATE INDEX source_annotations_end ON source_annotations (end_segment_id);

-- Any annotation that was attached to a source paragraph through the old
-- column becomes a note on that paragraph. No released version wrote such
-- rows; this only makes sure nothing could be left behind.
INSERT INTO source_annotations
    (id, workspace_id, source_id, source_file_id, kind, color, content,
     start_segment_id, end_segment_id, position, page_number, locator, section_path,
     created_at, updated_at, deleted_at, revision)
SELECT a.id, a.workspace_id, s.source_id, s.source_file_id,
       CASE WHEN a.kind = 'bookmark' THEN 'bookmark' ELSE 'note' END, NULL, a.content,
       s.id, s.id, s.position, s.page_number, s.locator, s.section_path,
       a.created_at, a.updated_at, a.deleted_at, a.revision
FROM annotations a
JOIN source_segments s ON s.id = a.source_segment_id
WHERE a.source_segment_id IS NOT NULL;
