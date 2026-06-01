-- =========================================================================
-- practice_texts.scope: record which review scope produced each text.
--
-- The reading queue is keyed by (user, target_language, pool) and shared
-- across scopes. A generated/in-progress text, however, only embeds the
-- candidate terms eligible under the scope that was active when it was made
-- (learn_new -> new terms only, review_due -> due review terms, mixed -> both).
--
-- Without recording that scope, re-entering a (user, lang, pool) under a
-- different scope would resume a stale in-progress 'reading' text — or consume
-- a pre-generated 'ready' slot — built for the *previous* scope (e.g. picking
-- "Learn new" but being shown a leftover mixed text full of already-reviewed
-- terms). Stamping the scope lets the selection path abandon mismatched slots
-- and generate fresh for the requested scope.
--
-- Nullable: legacy rows predate this column. The selection path treats a NULL
-- scope as "usable under any scope" so the one in-flight text at deploy time
-- isn't needlessly discarded.
-- =========================================================================

ALTER TABLE public.practice_texts
  ADD COLUMN scope text;

ALTER TABLE public.practice_texts
  ADD CONSTRAINT practice_texts_scope_check
  CHECK (scope IS NULL OR scope IN ('review_due', 'learn_new', 'mixed'));
