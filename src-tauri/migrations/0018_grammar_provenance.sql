-- Abiding Word — migration 0018: where a Bible's grammar codes come from (v0.22)
--
-- v0.21 described a Bible's morphology codes when nearly all of them fitted
-- the Open Scriptures Hebrew Bible's documented scheme. A fit is a check, not
-- provenance: codes shaped like OSHB's do not show that the publisher used
-- OSHB. From v0.22 codes are described only when the edition itself names
-- the scheme (its format, or a statement in the files that came with it), or
-- when the person chose the scheme at import. Details:
-- docs/original-language-v0.22.md.
--
-- Additive: three columns, all empty for existing rows. Bibles whose codes
-- v0.21 described on a fit alone keep their words and codes, shown as
-- written; the person can choose the scheme in Settings → Bibles.

-- The documented scheme the codes are described with, if any.
ALTER TABLE bible_word_annotations ADD COLUMN grammar_scheme TEXT
    CHECK (grammar_scheme IS NULL OR grammar_scheme IN ('oshb', 'robinson', 'morphgnt'));

-- On what grounds: 'edition' (the edition names the scheme) or 'person'
-- (the person chose it; the codes fitted it).
ALTER TABLE bible_word_annotations ADD COLUMN grammar_basis TEXT
    CHECK (grammar_basis IS NULL OR grammar_basis IN ('edition', 'person'));

-- JSON: where the edition names it ({"file": …, "words": …}), when it does.
ALTER TABLE bible_word_annotations ADD COLUMN grammar_evidence TEXT;

-- 'morph_scheme' now says only whether codes are present ('raw' or 'none').
UPDATE bible_word_annotations SET morph_scheme = 'raw' WHERE morph_scheme = 'oshb';
