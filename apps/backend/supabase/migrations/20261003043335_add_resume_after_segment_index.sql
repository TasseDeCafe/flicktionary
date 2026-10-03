-- The reader's resume anchor: the last segment the reader scrolled past (or
-- read into, per a gloss/save interaction). Distinct from
-- furthest_read_segment_index (the deepest segment ever on screen), which
-- over-reaches by a full viewport on large screens and so can't be where a
-- reading session resumes on another device. Monotonic like furthest_read
-- (GREATEST on the progress write, kept <= furthest_read); the manual
-- bookmark sets both exactly. NULL = nothing scrolled past yet: resume at the
-- text start.
ALTER TABLE public.study_sessions
  ADD COLUMN resume_after_segment_index integer;

-- Existing sessions only know the deepest visible line; start their anchor
-- there (the frontier the old restore aimed at).
UPDATE public.study_sessions
SET resume_after_segment_index = furthest_read_segment_index
WHERE furthest_read_segment_index IS NOT NULL;
