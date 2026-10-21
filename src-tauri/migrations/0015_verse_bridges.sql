-- Abiding Word — migration 0015: bridged verses (v0.18.8)
--
-- Some translations combine verses into one ("Romans 16:25-27"). The text is
-- stored on the bridge's first verse; this records where the bridge ends, so
-- that a passage's text on a material can show "25–27" and never call the
-- combined verses missing. Additive only: one new column, empty for Bibles
-- added before; their bridges are known once the Bible is added again.
-- Details: docs/baselines-materials-v0.18.8.md.

ALTER TABLE bible_verse_texts ADD COLUMN bridge_end INTEGER;
