-- Abiding Word — migration 0010: Presentation & Delivery (v0.18)
--
-- A presentation is how one Bible Teaching is delivered: which parts of the
-- teaching are shown, in which order, where the slide breaks are, what the
-- audience sees and what only the speaker sees. The teaching stays the
-- source of truth: an item names the part of the teaching it comes from and
-- follows it live; only what the person writes for the presentation itself
-- (their own heading or audience text, speaker notes) is stored here.
-- Exports and delivery packages are snapshots made from this on request.
--
-- Additive only: two new tables, nothing existing is changed.
-- Details: docs/presentation-delivery-v0.18.md.

CREATE TABLE presentations (
    id              TEXT PRIMARY KEY NOT NULL,
    preparation_id  TEXT NOT NULL REFERENCES teaching_preparations (id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    -- light, dark, warm (validated by the application)
    theme           TEXT NOT NULL DEFAULT 'light',
    -- The Bible the Scripture slides quote; NULL: the one the Scripture pane shows.
    translation_id  TEXT,
    position        INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    revision        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX presentations_preparation
    ON presentations (preparation_id, position) WHERE deleted_at IS NULL;

-- One slide (or a run of slides, for a long passage) in order.
CREATE TABLE presentation_items (
    id              TEXT PRIMARY KEY NOT NULL,
    presentation_id TEXT NOT NULL REFERENCES presentations (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    -- title, section, heading, text, scripture, image, quote, question,
    -- activity, pause (validated by the application)
    kind            TEXT NOT NULL,
    -- The part of the teaching it shows, followed live: preparation (with a
    -- field: title, central_message, introduction, conclusion), point,
    -- passage, material or finding. NULL: the presentation's own slide.
    source_kind     TEXT,
    source_id       TEXT,
    source_field    TEXT,
    -- The person's own wording for this presentation. NULL: follow the teaching.
    heading         TEXT,
    body            TEXT,
    -- A canonical reference (e.g. JHN.15.1-JHN.15.8). NULL: follow the source passage.
    reference       TEXT,
    -- Speaker-only notes. Never shown on the audience screen.
    notes           TEXT NOT NULL DEFAULT '',
    -- 1: left out of this presentation, but kept to be brought back.
    skipped         INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE INDEX presentation_items_presentation
    ON presentation_items (presentation_id, position) WHERE deleted_at IS NULL;
