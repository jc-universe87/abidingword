-- Abiding Word — migration 0009: kinds of teaching steps (v0.17)
--
-- A step of a lesson can say what kind of step it is: teaching, reading
-- Scripture, a question, an activity, a picture (and, later, audio). The
-- canvas of a children's or other lesson shows each step by its kind; a
-- sermon's points and a group study's questions do not need one.
--
-- Additive only: one new column, NULL for every existing point (shown as
-- before). Nothing existing is changed. Details:
-- docs/study-teaching-simplification-v0.17.md.

-- text, scripture, question, activity, image, audio (validated by the
-- application); NULL when not said.
ALTER TABLE teaching_points ADD COLUMN kind TEXT;
