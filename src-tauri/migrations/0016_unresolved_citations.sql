-- Abiding Word — migration 0016: citations kept without their library source (v0.19)
--
-- A project imported onto a computer that does not have a cited library
-- source used to lose the citation: finding_sources.source_id was required.
-- Now a citation can stand on its snapshot alone (title, author, quote,
-- locator, section, anchor) with no source row: source_id is empty and the
-- citation says what it cited. No placeholder source is ever made.
--
-- Two columns keep what is needed to reconnect it later without guessing:
--   cited_source_id     the source's id where the citation was made
--   cited_content_hash  SHA-256 of that source's file (sources.content_hash)
-- A source added later with exactly that file is reconnected; nothing is
-- matched by title. Details: docs/portability.md.
--
-- Consistent rows are copied unchanged, with their source's hash recorded.
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt; nothing
-- refers to finding_sources, so no other table changes.

CREATE TABLE finding_sources_v16 (
    id                  TEXT PRIMARY KEY NOT NULL,
    finding_id          TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
    source_id           TEXT REFERENCES sources (id) ON DELETE CASCADE,
    source_segment_id   TEXT REFERENCES source_segments (id) ON DELETE SET NULL,
    locator             TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,
    revision            INTEGER NOT NULL DEFAULT 1,
    cited_title         TEXT,
    cited_author        TEXT,
    quote               TEXT,
    cited_section       TEXT,
    anchor              TEXT,
    annotation_id       TEXT,
    cited_source_id     TEXT,
    cited_content_hash  TEXT,
    -- Without its source a citation must at least say what it cited.
    CHECK (source_id IS NOT NULL OR (cited_title IS NOT NULL AND trim(cited_title) <> ''))
);

-- Rows are copied as they are. Rows left inconsistent long ago (written
-- while foreign keys were off) would stop the upgrade, so: a source that no
-- longer exists becomes "not on this computer" (its snapshot kept, its
-- title from the snapshot, else as the app already showed it); a paragraph
-- that no longer exists becomes empty; the row of a note that no longer
-- exists, which could never be shown, is not copied. The verified backup
-- made before this migration keeps everything exactly as it was.
INSERT INTO finding_sources_v16
    (id, finding_id, source_id, source_segment_id, locator, created_at, updated_at,
     deleted_at, revision, cited_title, cited_author, quote, cited_section, anchor,
     annotation_id, cited_source_id, cited_content_hash)
SELECT c.id, c.finding_id,
       (SELECT s.id FROM sources s WHERE s.id = c.source_id),
       (SELECT g.id FROM source_segments g WHERE g.id = c.source_segment_id),
       c.locator, c.created_at, c.updated_at, c.deleted_at, c.revision,
       CASE WHEN EXISTS (SELECT 1 FROM sources s WHERE s.id = c.source_id) THEN c.cited_title
            ELSE COALESCE(NULLIF(trim(c.cited_title), ''), 'Removed source') END,
       c.cited_author, c.quote, c.cited_section, c.anchor, c.annotation_id, c.source_id,
       (SELECT s.content_hash FROM sources s WHERE s.id = c.source_id)
FROM finding_sources c
WHERE c.finding_id IN (SELECT id FROM findings);

DROP TABLE finding_sources;
ALTER TABLE finding_sources_v16 RENAME TO finding_sources;

CREATE INDEX finding_sources_finding ON finding_sources (finding_id);
CREATE INDEX finding_sources_source ON finding_sources (source_id);
CREATE INDEX finding_sources_cited_hash ON finding_sources (cited_content_hash)
    WHERE source_id IS NULL;
