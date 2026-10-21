-- Abiding Word — migration 0014: Bible Teaching templates of one's own (v0.18.7)
--
-- A Bible Teaching template is a starting structure for a teaching: its
-- format (sermon, group Bible study, lesson…) and the points, questions or
-- steps it starts with, with each step's kind. It holds structure only:
-- never a passage, writing, notes, findings or kept material.
--
-- Only the person's own templates live here. The built-in ones are
-- application text (resources/teaching-templates.json), shown in the
-- interface language, and cannot be changed; the person saves a copy to
-- make one their own. A teaching copies its template's points when it is
-- made and is never linked to it afterwards, so editing or deleting a
-- template never changes a teaching. Additive only: one new table.
-- Details: docs/user-templates-v0.18.7.md.
CREATE TABLE teaching_templates (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    -- sermon, bible_study, youth, children, lesson, talk, other (validated by the application)
    kind         TEXT NOT NULL,
    -- JSON: {"points": [{"key": "welcome", "title": "Welcome", "kind": "text"}]}
    --   key:   the built-in starting step it came from, if any (its title is then
    --          shown in the interface language while it is unchanged)
    --   kind:  a step's kind (text, scripture, question, activity, image), if any
    definition   TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    revision     INTEGER NOT NULL DEFAULT 1
);
