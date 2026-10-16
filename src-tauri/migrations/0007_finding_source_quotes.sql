-- v0.15 "From Sources to Study" (docs/sources-to-study-v0.15.md).
--
-- A finding's citation of a library source keeps, besides the title, author
-- and location it already snapshots (0004):
--
--   quote          what the source said: the selected stored text (segments
--                  joined with "\n"), apart from what the person wrote in the
--                  finding; kept when the source is removed.
--   cited_section  the section path at the time ("Chapter 3 › Grace"), for a
--                  readable location when there is no page; kept on removal.
--   anchor         small versioned JSON: where the words or place were in the
--                  stored text (segments and UTF-16 offsets with context, or a
--                  page of an Original PDF), to reopen the source exactly.
--   annotation_id  the source mark it was made from, if any. A weak link
--                  only: no foreign key, so deleting the mark never touches
--                  the finding or its citation.
--
-- Additive only: existing citations keep working with these left empty.

ALTER TABLE finding_sources ADD COLUMN quote TEXT;
ALTER TABLE finding_sources ADD COLUMN cited_section TEXT;
ALTER TABLE finding_sources ADD COLUMN anchor TEXT;
ALTER TABLE finding_sources ADD COLUMN annotation_id TEXT;
