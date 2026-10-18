-- v0.18.1: church presentation templates. A template is a reusable design
-- (slide size, colours, fonts, background, logo, footer, a layout per kind
-- of slide) kept once and chosen by any number of presentations. Its images
-- are files in the app's own data folder, named by their SHA-256. Additive
-- only: existing presentations keep their built-in background (NULL here).
CREATE TABLE presentation_templates (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    -- The design as JSON (format abiding-word/presentation-template).
    definition      TEXT NOT NULL,
    -- How it was made: pptx, package (another installation) or designer.
    source_format   TEXT NOT NULL DEFAULT 'designer',
    -- The file it came from, for the person (never read again).
    source_name     TEXT,
    -- The compatibility report shown when it was imported (JSON).
    report          TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    revision        INTEGER NOT NULL DEFAULT 1
);

-- NULL: the built-in background named by `theme`, as before.
ALTER TABLE presentations ADD COLUMN template_id TEXT REFERENCES presentation_templates (id);
