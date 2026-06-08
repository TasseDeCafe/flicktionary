-- Phase 4a: widen the `skill` CHECK to add 'pronunciation'.
--
-- The 'pronunciation' skill is a recognition-mode facet (passive queue): its
-- card drills the headword's pronunciation (audio chip front, IPA on the back).
-- It was already wired into the queue/budget/legal-pool scaffolding from Phase
-- 1-3 (skillsForReviewMode('recognition') lists it, isDailyNewCappedFacet
-- excludes it, isLegalPoolSkill('passive', 'pronunciation') is true) but had no
-- rows because the CHECK rejected them. Both the facet table and the rating-
-- events ledger must accept the new value (rate/undo writes the skill there).
--
-- CHECK widening only — no data change. The two constraints move together so a
-- pronunciation rating can never be written against a facet the events ledger
-- would reject (or vice versa).

ALTER TABLE public.study_facets
  DROP CONSTRAINT study_facets_skill_check,
  ADD CONSTRAINT study_facets_skill_check
    CHECK (skill IN ('meaning_recognition', 'meaning_production', 'pronunciation'));

ALTER TABLE public.practice_rating_events
  DROP CONSTRAINT practice_rating_events_skill_check,
  ADD CONSTRAINT practice_rating_events_skill_check
    CHECK (skill IN ('meaning_recognition', 'meaning_production', 'pronunciation'));
