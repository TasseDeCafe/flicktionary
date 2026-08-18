-- Per-candidate evidence for the checkpoint claims sheet: which surface form
-- of the saved word was seen and a match-centered context window, keyed by
-- user_lookup_id ({"<uuid>": {"surface": "...", "context": "..."}}). Written at
-- checkpoint insert alongside backlog_candidate_ids so getCheckpointClaims can
-- rehydrate the sheet with the same evidence the collect response carried.
-- NULL for checkpoints created before this column existed.
ALTER TABLE public.study_session_checkpoints ADD COLUMN backlog_evidence jsonb;
