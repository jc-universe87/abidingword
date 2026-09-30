-- Abiding Word — migration 0003: Studies (Studies v0.3)
--
-- Study types and status, structured findings (with passages, tags and a
-- prepared link to sources), primary/related study passages, relations
-- between studies, typed templates, and full-text search over studies.
-- Additive only: no existing row is removed or rewritten except where
-- noted (study passage roles). Details: docs/studies-v0.3.md.

-- ---------------------------------------------------------------------------
-- Studies: type, status, purpose, type-specific details.
-- Existing studies were all created from the passage-study template, so they
-- become passage studies.
-- ---------------------------------------------------------------------------

ALTER TABLE studies ADD COLUMN study_type TEXT NOT NULL DEFAULT 'passage';
ALTER TABLE studies ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE studies ADD COLUMN description TEXT;
-- JSON: optional fields that depend on the type, e.g. {"lemma": "…",
-- "originalLanguage": "grc"} for a word study or {"audience": "…"} for a
-- teaching study. Validated by the application.
ALTER TABLE studies ADD COLUMN details TEXT;

CREATE INDEX studies_type_status ON studies (study_type, status) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Findings (table from 0001): ordering and threading.
-- Finding passages use passage_references (owner: finding_id), as 0001
-- already allows.
-- ---------------------------------------------------------------------------

ALTER TABLE findings ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE findings ADD COLUMN parent_id TEXT REFERENCES findings (id) ON DELETE SET NULL;

CREATE INDEX findings_study_order ON findings (study_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE finding_tags (
    finding_id  TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
    -- Lower case, trimmed; validated by the application.
    tag         TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (finding_id, tag)
) WITHOUT ROWID;

CREATE INDEX finding_tags_tag ON finding_tags (tag);

-- Where a finding came from in the user's library. Structure only in v0.3:
-- the Library phase fills it. A link names a source and, optionally, the
-- exact segment and a human-readable locator (page, timestamp…).
CREATE TABLE finding_sources (
    id                 TEXT PRIMARY KEY NOT NULL,
    finding_id         TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
    source_id          TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    source_segment_id  TEXT REFERENCES source_segments (id) ON DELETE SET NULL,
    locator            TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT,
    revision           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX finding_sources_finding ON finding_sources (finding_id);
CREATE INDEX finding_sources_source ON finding_sources (source_id);

-- ---------------------------------------------------------------------------
-- Study passages: primary or related.
-- For each study, its earliest live passage becomes primary; all other study
-- passages become related. Passages owned by blocks or findings have no role.
-- ---------------------------------------------------------------------------

ALTER TABLE passage_references ADD COLUMN role TEXT
    CHECK (role IS NULL OR role IN ('primary', 'related'));

UPDATE passage_references SET role = 'related' WHERE study_id IS NOT NULL;

UPDATE passage_references SET role = 'primary'
WHERE study_id IS NOT NULL AND deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM passage_references earlier
      WHERE earlier.study_id = passage_references.study_id
        AND earlier.deleted_at IS NULL
        AND (earlier.created_at < passage_references.created_at
             OR (earlier.created_at = passage_references.created_at
                 AND earlier.id < passage_references.id))
  );

CREATE UNIQUE INDEX passage_references_one_primary
    ON passage_references (study_id) WHERE role = 'primary' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Relations between studies.
-- ---------------------------------------------------------------------------

CREATE TABLE study_relations (
    id             TEXT PRIMARY KEY NOT NULL,
    from_study_id  TEXT NOT NULL REFERENCES studies (id) ON DELETE CASCADE,
    to_study_id    TEXT NOT NULL REFERENCES studies (id) ON DELETE CASCADE,
    -- related, continues, contrasts, supports, custom (validated by the app)
    relation_type  TEXT NOT NULL,
    note           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    revision       INTEGER NOT NULL DEFAULT 1,
    CHECK (from_study_id <> to_study_id)
);

CREATE UNIQUE INDEX study_relations_pair
    ON study_relations (from_study_id, to_study_id) WHERE deleted_at IS NULL;
CREATE INDEX study_relations_to ON study_relations (to_study_id);

-- ---------------------------------------------------------------------------
-- Templates: the study type a template is meant for.
-- ---------------------------------------------------------------------------

ALTER TABLE study_templates ADD COLUMN study_type TEXT NOT NULL DEFAULT 'custom';
UPDATE study_templates SET study_type = 'passage' WHERE key = 'passage-study';

-- ---------------------------------------------------------------------------
-- Study search (FTS5).
--
-- study_search_items gives every searchable item (a study's title and
-- purpose, a section title, a block, a finding) a stable integer id, used
-- as the rowid in the full-text table. Triggers keep both in step with the
-- source tables, so no code path can forget to update the index. Deleted
-- (soft or hard) items leave the index.
-- ---------------------------------------------------------------------------

CREATE TABLE study_search_items (
    id        INTEGER PRIMARY KEY,
    item_id   TEXT NOT NULL UNIQUE,
    kind      TEXT NOT NULL CHECK (kind IN ('study', 'section', 'block', 'finding')),
    study_id  TEXT NOT NULL
);

CREATE INDEX study_search_items_study ON study_search_items (study_id);

CREATE VIRTUAL TABLE study_search USING fts5 (
    text,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- studies ------------------------------------------------------------------

CREATE TRIGGER study_search_studies_ai AFTER INSERT ON studies
WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO study_search_items (item_id, kind, study_id) VALUES (new.id, 'study', new.id);
    INSERT INTO study_search (rowid, text)
        SELECT id, new.title || ' ' || COALESCE(new.description, '')
        FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_studies_au AFTER UPDATE OF title, description, deleted_at ON studies BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
    INSERT INTO study_search_items (item_id, kind, study_id)
        SELECT new.id, 'study', new.id WHERE new.deleted_at IS NULL;
    INSERT INTO study_search (rowid, text)
        SELECT id, new.title || ' ' || COALESCE(new.description, '')
        FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_studies_ad AFTER DELETE ON studies BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
END;

-- sections -----------------------------------------------------------------

CREATE TRIGGER study_search_sections_ai AFTER INSERT ON study_sections
WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO study_search_items (item_id, kind, study_id) VALUES (new.id, 'section', new.study_id);
    INSERT INTO study_search (rowid, text)
        SELECT id, new.title FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_sections_au AFTER UPDATE OF title, deleted_at ON study_sections BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
    INSERT INTO study_search_items (item_id, kind, study_id)
        SELECT new.id, 'section', new.study_id WHERE new.deleted_at IS NULL;
    INSERT INTO study_search (rowid, text)
        SELECT id, new.title FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_sections_ad AFTER DELETE ON study_sections BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
END;

-- blocks -------------------------------------------------------------------

CREATE TRIGGER study_search_blocks_ai AFTER INSERT ON study_blocks
WHEN new.deleted_at IS NULL AND new.content <> '' BEGIN
    INSERT INTO study_search_items (item_id, kind, study_id)
        SELECT new.id, 'block', study_id FROM study_sections WHERE id = new.section_id;
    INSERT INTO study_search (rowid, text)
        SELECT id, new.content FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_blocks_au AFTER UPDATE OF content, deleted_at ON study_blocks BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
    INSERT INTO study_search_items (item_id, kind, study_id)
        SELECT new.id, 'block', study_id FROM study_sections
        WHERE id = new.section_id AND new.deleted_at IS NULL AND new.content <> '';
    INSERT INTO study_search (rowid, text)
        SELECT id, new.content FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_blocks_ad AFTER DELETE ON study_blocks BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
END;

-- findings -----------------------------------------------------------------

CREATE TRIGGER study_search_findings_ai AFTER INSERT ON findings
WHEN new.deleted_at IS NULL AND new.content <> '' BEGIN
    INSERT INTO study_search_items (item_id, kind, study_id) VALUES (new.id, 'finding', new.study_id);
    INSERT INTO study_search (rowid, text)
        SELECT id, new.content FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_findings_au AFTER UPDATE OF content, deleted_at ON findings BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
    INSERT INTO study_search_items (item_id, kind, study_id)
        SELECT new.id, 'finding', new.study_id WHERE new.deleted_at IS NULL AND new.content <> '';
    INSERT INTO study_search (rowid, text)
        SELECT id, new.content FROM study_search_items WHERE item_id = new.id;
END;

CREATE TRIGGER study_search_findings_ad AFTER DELETE ON findings BEGIN
    DELETE FROM study_search WHERE rowid = (SELECT id FROM study_search_items WHERE item_id = old.id);
    DELETE FROM study_search_items WHERE item_id = old.id;
END;

-- Index what already exists.

INSERT INTO study_search_items (item_id, kind, study_id)
    SELECT id, 'study', id FROM studies WHERE deleted_at IS NULL;
INSERT INTO study_search_items (item_id, kind, study_id)
    SELECT id, 'section', study_id FROM study_sections WHERE deleted_at IS NULL;
INSERT INTO study_search_items (item_id, kind, study_id)
    SELECT b.id, 'block', s.study_id FROM study_blocks b JOIN study_sections s ON s.id = b.section_id
    WHERE b.deleted_at IS NULL AND b.content <> '';
INSERT INTO study_search_items (item_id, kind, study_id)
    SELECT id, 'finding', study_id FROM findings WHERE deleted_at IS NULL AND content <> '';

INSERT INTO study_search (rowid, text)
    SELECT i.id, st.title || ' ' || COALESCE(st.description, '')
    FROM study_search_items i JOIN studies st ON st.id = i.item_id WHERE i.kind = 'study';
INSERT INTO study_search (rowid, text)
    SELECT i.id, se.title FROM study_search_items i JOIN study_sections se ON se.id = i.item_id
    WHERE i.kind = 'section';
INSERT INTO study_search (rowid, text)
    SELECT i.id, b.content FROM study_search_items i JOIN study_blocks b ON b.id = i.item_id
    WHERE i.kind = 'block';
INSERT INTO study_search (rowid, text)
    SELECT i.id, f.content FROM study_search_items i JOIN findings f ON f.id = i.item_id
    WHERE i.kind = 'finding';
