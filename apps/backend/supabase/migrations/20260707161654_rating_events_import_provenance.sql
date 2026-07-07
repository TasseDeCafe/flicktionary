-- Import provenance on rating events: a lesson-import confirm applies implicit
-- 'again' lapses to already-known terms. The column marks those events so
-- (a) they are auditable, and (b) the daily review budget excludes them —
-- a big import must not eat the day's review allowance (the budget queries
-- add AND import_batch_id IS NULL).
ALTER TABLE public.practice_rating_events
  ADD COLUMN import_batch_id UUID NULL,
  ADD CONSTRAINT practice_rating_events_import_batch_id_fkey FOREIGN KEY (import_batch_id)
    REFERENCES public.import_batches (id) ON DELETE SET NULL;
