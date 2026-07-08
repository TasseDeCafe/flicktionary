-- Background extraction of a lesson-notes import batch (one Opus call per
-- lesson section + duplicate resolution). The value must commit before the
-- next migration can reference it in constraints/indexes.
ALTER TYPE public.processing_job_kind ADD VALUE IF NOT EXISTS 'extract_lesson';
