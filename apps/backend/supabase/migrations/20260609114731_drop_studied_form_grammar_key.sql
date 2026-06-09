-- Drop the retired grammar.studied_form generation artifact.
--
-- Background: per-form study moved to study_facets in Phase 4b. At that point
-- grammar.studied_form was demoted to a WRITE-ONLY generation artifact (still
-- written by buildStudiedFormPatch / the explore enrichment, but read by nothing
-- at runtime — display reads the form facet's payload, and the "+ Add a form"
-- picker reads cards.surface_form). It is now removed entirely: the writers are
-- deleted (buildStudiedFormPatch + its call sites), study_form is gone from
-- GrammarSchema, and this strips the dead key from every grammar bag.
--
-- Coverage: every row carrying the key, NOT gated on count/deleted_at — a
-- soft-deleted / unkept term keeps its grammar bag, so it must be cleaned too.
-- Idempotent (the `?` guard makes a re-run a no-op).
UPDATE public.user_lookups
SET grammar = grammar - 'studied_form'
WHERE grammar ? 'studied_form';
