-- Drop user_lookups.learning_mode (study-facets Phase 3).
--
-- "Active vocabulary" is no longer a stored term-level flag. A term is "in
-- production study" iff it has an ENABLED (disabled_at IS NULL) citation
-- meaning_production study_facets row. Phase 1's cutover backfilled those facets
-- and kept disabled_at in sync with learning_mode (setLearningMode, now
-- setFacetEnabled), so the column is fully derivable. Every backend reader was
-- repointed to derive learning_mode from the production facet before this DROP.
--
-- Guard: abort the (irreversible) DROP unless the invariant
--   learning_mode = 'active'  <=>  an enabled meaning_production citation facet exists
-- holds for EVERY user_lookups row. This catches any drift that crept in between
-- the Phase 1 cutover and now, before we lose the column we'd need to recover.

DO $$
DECLARE
  mismatch_count bigint;
BEGIN
  SELECT count(*)
  INTO mismatch_count
  FROM public.user_lookups ul
  LEFT JOIN public.study_facets f
    ON f.user_lookup_id = ul.id
    AND f.skill = 'meaning_production'
    AND f.target_form = ''
  WHERE (ul.learning_mode = 'active')
        IS DISTINCT FROM
        (f.id IS NOT NULL AND f.disabled_at IS NULL);

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'drop_learning_mode aborted: % user_lookups row(s) where learning_mode disagrees with the enabled meaning_production citation facet',
      mismatch_count;
  END IF;
END $$;

-- Postgres auto-drops the column's DEFAULT and CHECK constraint with the column.
ALTER TABLE public.user_lookups DROP COLUMN learning_mode;
