-- Lesson-notes imports create one content_source per confirmed batch,
-- distinguished from the per-(user, language) 'adhoc' source by this value.
-- A new enum value cannot be referenced as a literal in the migration that
-- adds it, so anything keying on type = 'lesson' lives in later migrations
-- (none needed today — sources are created at confirm time by the service).
ALTER TYPE public.content_source_type ADD VALUE IF NOT EXISTS 'lesson';
