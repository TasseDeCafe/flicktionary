-- Resume-reading position. Stores the deepest (highest-index) segment the reader
-- has reached in a session's track, so reopening the session can land them back
-- where they left off instead of at the top. Track-relative segment index (the
-- same `text_segments.index` the reading-position observer reports), never a
-- client array position. NULL = never tracked (new session / never scrolled).
ALTER TABLE public.study_sessions
  ADD COLUMN furthest_read_segment_index INTEGER NULL;
