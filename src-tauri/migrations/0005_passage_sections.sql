-- Passage-aware sources (v0.9): why a source segment is linked to Scripture.
--
-- `source_passages` (0004) held only literal mentions found in segment text.
-- A heading such as "John 15:1–11 — The True Vine" is not a segment (the
-- importers keep headings as structure, not as text), and the paragraphs below
-- it rarely repeat the reference, so none of that was linked. Two derived kinds
-- of link are added next to the literal one, each with its provenance in its
-- own column rather than hidden in another field:
--
--   explicit   the segment's own text contains the reference (every row so far)
--   section    the heading that opens a section names the passage; the link sits
--              on the section's first segment (its opening place)
--   inherited  any later segment of that section (until it ends), linked to the
--              passage the nearest heading above it names
--   manual     reserved for links a person confirms; nothing writes it yet
--
-- All links are canonical Scripture references (as in 0004), not anchors in any
-- translation's text. Derived links (section, inherited) come only from the
-- stored structure (`section_path`) and can be deleted and rebuilt at any
-- time without touching explicit links, segments, citations or files.
--
-- No existing row is rewritten: existing rows are explicit by the default.

ALTER TABLE source_passages ADD COLUMN origin TEXT NOT NULL DEFAULT 'explicit'
    CHECK (origin IN ('explicit', 'section', 'inherited', 'manual'));

-- For section and inherited links: the first segment of the defining section
-- (the opening place) and the heading's own text. NULL for explicit links.
ALTER TABLE source_passages ADD COLUMN section_segment_id TEXT
    REFERENCES source_segments (id) ON DELETE CASCADE;
ALTER TABLE source_passages ADD COLUMN section_heading TEXT;

-- Lookup by passage, narrowed by kind: derived "inherited" links are by far
-- the most numerous and are only needed for one segment at a time.
CREATE INDEX source_passages_origin_range ON source_passages (origin, start_key, end_key);
CREATE INDEX source_passages_section ON source_passages (section_segment_id);

-- Which version of the derivation a source's links were last built with.
-- 0 = never (every source that existed before this migration); the app
-- rebuilds those once, after the migration (and its backup), at startup.
ALTER TABLE sources ADD COLUMN passage_index_version INTEGER NOT NULL DEFAULT 0;
