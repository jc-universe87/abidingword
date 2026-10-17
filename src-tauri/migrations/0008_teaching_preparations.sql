-- Abiding Word — migration 0008: Teaching Preparation (v0.16)
--
-- A study can lead to one or more teaching preparations (a sermon, a
-- small-group study, a youth lesson…). A preparation is the person's own
-- writing: audience, purpose, central message, introduction, ordered main
-- points, conclusion and notes. It REUSES the study's findings and names
-- Scripture by canonical reference; it never copies a finding.
--
-- Additive only: four new tables, nothing existing is changed.
-- Details: docs/teaching-preparation-v0.16.md.

CREATE TABLE teaching_preparations (
    id              TEXT PRIMARY KEY NOT NULL,
    study_id        TEXT NOT NULL REFERENCES studies (id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    -- sermon, bible_study, youth, children, lesson, talk, other (validated by
    -- the application); NULL when not said.
    kind            TEXT,
    audience        TEXT,
    purpose         TEXT,
    central_message TEXT,
    introduction    TEXT NOT NULL DEFAULT '',
    conclusion      TEXT NOT NULL DEFAULT '',
    -- The teacher's own notes (not shown to the audience).
    notes           TEXT NOT NULL DEFAULT '',
    position        INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    revision        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX teaching_preparations_study
    ON teaching_preparations (study_id, position) WHERE deleted_at IS NULL;

-- Main points in order. No fixed number and no fixed shape: a point may be a
-- narrative movement, a question, a theme or an exposition of verses.
CREATE TABLE teaching_points (
    id              TEXT PRIMARY KEY NOT NULL,
    preparation_id  TEXT NOT NULL REFERENCES teaching_preparations (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    explanation     TEXT NOT NULL DEFAULT '',
    application     TEXT NOT NULL DEFAULT '',
    illustration    TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    revision        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX teaching_points_preparation
    ON teaching_points (preparation_id, position) WHERE deleted_at IS NULL;

-- A study finding used in a preparation (as a whole, or under one point).
-- A live reference: the finding stays the study's, edits to it show here,
-- and removing the link never touches the finding. When the finding is
-- deleted in the study it no longer shows here.
CREATE TABLE teaching_finding_links (
    id              TEXT PRIMARY KEY NOT NULL,
    preparation_id  TEXT NOT NULL REFERENCES teaching_preparations (id) ON DELETE CASCADE,
    point_id        TEXT REFERENCES teaching_points (id) ON DELETE CASCADE,
    finding_id      TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE UNIQUE INDEX teaching_finding_links_once
    ON teaching_finding_links (preparation_id, COALESCE(point_id, ''), finding_id)
    WHERE deleted_at IS NULL;
CREATE INDEX teaching_finding_links_finding ON teaching_finding_links (finding_id);

-- Scripture named in a preparation, by canonical reference (book code and
-- chapter/verse range, as in passage_references), for the whole preparation
-- or one point. Never added to the study's own passages.
CREATE TABLE teaching_passages (
    id              TEXT PRIMARY KEY NOT NULL,
    preparation_id  TEXT NOT NULL REFERENCES teaching_preparations (id) ON DELETE CASCADE,
    point_id        TEXT REFERENCES teaching_points (id) ON DELETE CASCADE,
    book            TEXT NOT NULL,
    start_chapter   INTEGER NOT NULL CHECK (start_chapter >= 1),
    start_verse     INTEGER CHECK (start_verse >= 1),
    end_chapter     INTEGER CHECK (end_chapter >= 1),
    end_verse       INTEGER CHECK (end_verse >= 1),
    position        INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE INDEX teaching_passages_preparation
    ON teaching_passages (preparation_id, position) WHERE deleted_at IS NULL;

-- What the person chose to keep from the assistant: a real story found and
-- checked (with its sources), an illustration idea (marked as invented), a
-- found image (with its source and licence) or a generated image (marked as
-- generated), a visual idea. Nothing is stored unless the person keeps it, and
-- it is always shown apart from their own writing.
CREATE TABLE teaching_materials (
    id              TEXT PRIMARY KEY NOT NULL,
    preparation_id  TEXT NOT NULL REFERENCES teaching_preparations (id) ON DELETE CASCADE,
    point_id        TEXT REFERENCES teaching_points (id) ON DELETE CASCADE,
    -- story, illustration, image, visual (validated by the application)
    kind            TEXT NOT NULL,
    -- verified, unverified, hypothetical, found, generated, suggestion
    standing        TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    -- JSON list of {title, url, site, excerpt}: only addresses the assistant
    -- was actually given by a search, never ones it wrote itself.
    sources         TEXT,
    -- JSON for images: {url, pageUrl, thumbUrl, licence, licenceUrl, author,
    -- attribution, file} (file: a generated image saved in the data folder).
    image           TEXT,
    -- Which assistant produced it (for provenance only).
    assistant       TEXT,
    position        INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE INDEX teaching_materials_preparation
    ON teaching_materials (preparation_id, position) WHERE deleted_at IS NULL;
