-- Abiding Word — migration 0013: where a study's parts belong in its movement (v0.18.7)
--
-- A part of a Bible Study can say where it belongs in the study's movement:
-- text, understanding, theology, application, audience or teaching. Its
-- template says so for new studies (resources/templates/*.json and the
-- person's own templates); the study keeps its own copy, so a later change to
-- the template never changes a study made from it.
--
-- Additive only: one new column. Existing parts made from a built-in part are
-- given the phase v0.18.6 showed for them (the same rules, by the part's key
-- and the kind of study), so every study looks as it did. A part the person
-- added themselves stays without a phase. The person's own templates are
-- given the same phases for the parts they took from a built-in template, so
-- a study made from one later looks as one made before. No text, block,
-- note or position is changed. Details: docs/user-templates-v0.18.7.md.

-- text, understanding, theology, application, audience, teaching (validated
-- by the application); NULL when the part has none.
ALTER TABLE study_sections ADD COLUMN phase TEXT;

-- Where the same built-in part means something else in a kind of study.
UPDATE study_sections SET phase = 'theology'
WHERE key = 'conclusions'
  AND study_id IN (SELECT id FROM studies WHERE study_type = 'systematic_theology');

UPDATE study_sections SET phase = 'teaching'
WHERE key IN ('purpose', 'audience', 'structure', 'application')
  AND study_id IN (SELECT id FROM studies WHERE study_type = 'teaching');

-- Every other built-in part, by its key.
UPDATE study_sections SET phase = CASE
    WHEN key IN ('text', 'observations', 'context', 'structure', 'key-words', 'word',
                 'occurrences', 'topic', 'key-passages', 'key-texts', 'doctrine', 'theme')
        THEN 'text'
    WHEN key IN ('meaning', 'exegesis', 'main-idea', 'related-scripture', 'open-questions',
                 'semantic-range', 'immediate-contexts', 'main-themes', 'biblical-context',
                 'difficult-passages', 'old-testament', 'new-testament', 'gospels', 'epistles',
                 'canonical-development', 'conclusions')
        THEN 'understanding'
    WHEN key IN ('theology', 'fulfilment', 'synthesis', 'biblical-synthesis',
                 'historical-theology', 'confessional-witness', 'alternative-positions',
                 'theological-significance')
        THEN 'theology'
    WHEN key = 'application' THEN 'application'
    WHEN key = 'audience' THEN 'audience'
    WHEN key IN ('teaching', 'teaching-outline', 'illustrations', 'purpose') THEN 'teaching'
END
WHERE phase IS NULL AND key IS NOT NULL;

-- The person's own templates: the same phases for the parts taken from a
-- built-in one (their key), in the same order; a part of their own stays
-- without one. Built-in templates are reinstalled with their phases at
-- startup (resources/templates/*.json).
UPDATE study_templates SET definition = json_set(definition, '$.sections', (
    SELECT json_group_array(CASE WHEN part.phase IS NULL THEN json(part.value)
                                 ELSE json_set(part.value, '$.phase', part.phase) END)
    FROM (SELECT value, CASE
              WHEN json_extract(value, '$.key') = 'conclusions' AND study_templates.study_type = 'systematic_theology' THEN 'theology'
              WHEN json_extract(value, '$.key') IN ('purpose', 'audience', 'structure', 'application') AND study_templates.study_type = 'teaching' THEN 'teaching'
              WHEN json_extract(value, '$.key') IN ('text', 'observations', 'context', 'structure', 'key-words', 'word',
                           'occurrences', 'topic', 'key-passages', 'key-texts', 'doctrine', 'theme')
                  THEN 'text'
              WHEN json_extract(value, '$.key') IN ('meaning', 'exegesis', 'main-idea', 'related-scripture', 'open-questions',
                           'semantic-range', 'immediate-contexts', 'main-themes', 'biblical-context',
                           'difficult-passages', 'old-testament', 'new-testament', 'gospels', 'epistles',
                           'canonical-development', 'conclusions')
                  THEN 'understanding'
              WHEN json_extract(value, '$.key') IN ('theology', 'fulfilment', 'synthesis', 'biblical-synthesis',
                           'historical-theology', 'confessional-witness', 'alternative-positions',
                           'theological-significance')
                  THEN 'theology'
              WHEN json_extract(value, '$.key') = 'application' THEN 'application'
              WHEN json_extract(value, '$.key') = 'audience' THEN 'audience'
              WHEN json_extract(value, '$.key') IN ('teaching', 'teaching-outline', 'illustrations', 'purpose') THEN 'teaching'
          END AS phase
          FROM json_each(study_templates.definition, '$.sections')
          ORDER BY CAST(key AS INTEGER)) AS part))
WHERE is_builtin = 0 AND json_type(definition, '$.sections') = 'array';
