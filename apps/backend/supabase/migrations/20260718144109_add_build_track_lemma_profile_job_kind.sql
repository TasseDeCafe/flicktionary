-- Background build of a text track's lemma profile (tokenize → resolve
-- candidate lemmas → write text_track_lemma_profiles). The value must commit
-- before the next migration can reference it in constraints/indexes (the
-- extract_lesson two-migration precedent).
ALTER TYPE public.processing_job_kind ADD VALUE IF NOT EXISTS 'build_track_lemma_profile';
