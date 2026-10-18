-- v0.18: an optional target time for a presentation, in minutes. NULL: none.
-- The Presenter View shows quiet time guidance against it. Additive only.
ALTER TABLE presentations ADD COLUMN target_minutes INTEGER;
