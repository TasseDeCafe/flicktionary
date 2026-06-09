-- Phase 4b: migrate the old grammar.study_form_enabled / grammar.studied_form
-- single-slot "study this form" toggle to first-class per-form study facets.
--
-- Old model (the bug this replaces): a term carried ONE studied_form slot in its
-- grammar bag (last-write-wins across every highlighted inflection) plus a
-- term-global study_form_enabled boolean. Enabling it merely swapped the FRONT
-- of the citation recognition card to the stored form — the form had no schedule
-- of its own, and a second inflection of the same lemma silently overwrote the
-- slot. New model: each studied form is its own (meaning_recognition, <form>)
-- facet with an independent FSRS schedule (Worked example 2).
--
-- This migration creates one enabled, ready form facet for every term the user
-- had ACTIVELY enabled (study_form_enabled='true') with a well-formed
-- studied_form.form, then strips study_form_enabled from every grammar bag.
-- grammar.studied_form is LEFT in place as the generation artifact (the focus
-- view / enrichment passes still write it; Phase 4b just stops reading it for
-- display). Terms whose toggle was off keep their generated studied_form but get
-- no facet — the form stays available as a "+ Add a form" candidate sourced from
-- cards.surface_form.
--
-- Coverage: gated on the user's explicit toggle (study_form_enabled='true'), NOT
-- on count/deleted_at (Trap 2) — an unkeep/soft-delete leaves grammar intact and
-- the facet FK-cascades with the term, so there is nothing to lose by migrating a
-- currently-unkept term's enabled form.
--
-- Born srs_state NULL (unseen): the old toggle rode the citation card's schedule,
-- so the form has no schedule to inherit — it enters as a brand-new opt-in card
-- (the citation recognition card reverts to drilling the lemma).
--
-- Key normalizer — MUST stay byte-identical to normalizeTargetForm() in
-- packages/core/src/utils/normalize-target-form.ts (Trap 21):
--   lower(trim(normalize(regexp_replace(form, U+0301, '', 'g'), NFC)))
-- i.e. strip combining acute U+0301 -> NFC -> trim -> lowercase. payload.form
-- keeps the FULL display form (stress intact); only the key collapses.

DO $migrate$
DECLARE
  v_migrated INT := 0;
  v_skipped  INT := 0;
BEGIN
  WITH src AS (
    SELECT
      ul.id            AS user_lookup_id,
      ul.user_id       AS user_id,
      ul.target_language AS target_language,
      ul.grammar->'studied_form'->>'form'        AS form_text,
      ul.grammar->'studied_form'->'translation'  AS translation_json
    FROM public.user_lookups ul
    WHERE ul.grammar->>'study_form_enabled' = 'true'
  ),
  valid AS (
    SELECT
      user_lookup_id, user_id, target_language, form_text, translation_json,
      lower(trim(normalize(regexp_replace(form_text, U&'\0301', '', 'g'), NFC))) AS norm_form
    FROM src
    WHERE form_text IS NOT NULL
      AND btrim(form_text) <> ''
  ),
  ins AS (
    INSERT INTO public.study_facets (
      user_lookup_id, user_id, target_language, skill, target_form,
      payload, data_status, source
    )
    SELECT
      user_lookup_id, user_id, target_language, 'meaning_recognition', norm_form,
      jsonb_build_object('form', form_text, 'translation', translation_json),
      'ready', 'highlight'
    FROM valid
    WHERE norm_form <> ''
    ON CONFLICT (user_lookup_id, skill, target_form) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_migrated FROM ins;

  -- Enabled terms whose studied_form is empty/missing or normalizes away — left
  -- as-is (no facet), counted so the migration is auditable rather than silent.
  SELECT count(*) INTO v_skipped
  FROM public.user_lookups ul
  WHERE ul.grammar->>'study_form_enabled' = 'true'
    AND (
      ul.grammar->'studied_form'->>'form' IS NULL
      OR btrim(ul.grammar->'studied_form'->>'form') = ''
      OR lower(trim(normalize(regexp_replace(ul.grammar->'studied_form'->>'form', U&'\0301', '', 'g'), NFC))) = ''
    );

  RAISE NOTICE 'migrate_study_form_to_form_facet: migrated % form facet(s); skipped % enabled term(s) with empty/invalid studied_form',
    v_migrated, v_skipped;
END
$migrate$;

-- Strip the retired display toggle from EVERY grammar bag (Trap 10 — same
-- migration as the inserts above). studied_form stays (generation artifact).
UPDATE public.user_lookups
SET grammar = grammar - 'study_form_enabled'
WHERE grammar ? 'study_form_enabled';
