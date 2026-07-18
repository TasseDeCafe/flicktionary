-- =========================================================================
-- text_track_lemma_profiles — the per-track lemma profile backing the
-- personalized difficulty stat (docs/proposals/
-- checkpoint-reviews-and-known-vocabulary.md Feature 3). One row per distinct
-- folded word token of the track, carrying its occurrence count and ALL
-- candidate lemmas the checkpoint matcher resolves it to. Storing token-level
-- candidate GROUPS (not per-lemma counts) is what lets the difficulty query
-- conserve mass under ambiguity: each token contributes
-- token_count × max(P(candidate)) exactly once, so coverage can never exceed
-- 100%.
--
-- Built by the build_track_lemma_profile background job (delete + insert in
-- one transaction, serialized per track by an advisory lock). Backend
-- reads/writes only — RLS enabled with no policies.
-- =========================================================================

CREATE TABLE public.text_track_lemma_profiles (
  text_track_id UUID NOT NULL,
  folded_token TEXT NOT NULL,
  token_count INT NOT NULL,
  -- Deduplicated at write time; folded through checkpoint_fold like every
  -- other lemma key.
  candidate_lemmas TEXT[] NOT NULL,
  CONSTRAINT text_track_lemma_profiles_pkey PRIMARY KEY (text_track_id, folded_token),
  CONSTRAINT text_track_lemma_profiles_text_track_id_fkey FOREIGN KEY (text_track_id)
    REFERENCES public.text_tracks (id) ON DELETE CASCADE,
  CONSTRAINT text_track_lemma_profiles_token_count_positive CHECK (token_count > 0),
  CONSTRAINT text_track_lemma_profiles_candidates_non_empty CHECK (cardinality(candidate_lemmas) > 0)
);

ALTER TABLE public.text_track_lemma_profiles ENABLE ROW LEVEL SECURITY;

-- Profile bookkeeping on the track itself. profile_built_at doubles as the
-- "profile exists" signal; segment count + max index are the cheap staleness
-- check (non-adhoc, non-lesson tracks are immutable after import, so drift
-- means the invariant broke and the profile must rebuild). The token counts
-- are stored for honesty/debugging: the difficulty denominator is
-- matched tokens, and keeping both makes the gap visible.
ALTER TABLE public.text_tracks
  ADD COLUMN profile_built_at TIMESTAMPTZ NULL,
  ADD COLUMN profile_segment_count INT NULL,
  ADD COLUMN profile_max_segment_index INT NULL,
  ADD COLUMN profile_word_token_count INT NULL,
  ADD COLUMN profile_matched_token_count INT NULL;
