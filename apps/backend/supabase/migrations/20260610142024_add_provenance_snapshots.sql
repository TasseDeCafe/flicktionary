-- Per-field provenance snapshots. Provenance is COMPUTED at render time by
-- comparing current values against these snapshots — no per-field edit stamps.

-- Snapshot of the kaikki grammar patch applied at grounding time (the exact
-- jsonb merged into grammar by applyGroundingPatch). NULL = never grounded OR
-- grounded before this column existed; legacy rows make no per-field claims
-- until the grounding runner re-grounds them (it backfills grounded rows that
-- lack a patch whenever a new session/highlight touches them).
ALTER TABLE public.user_lookups ADD COLUMN grounding_patch JSONB NULL;

-- Snapshot of the generated form-facet payload written by the Opus
-- generate pass (or the translations-off shortcut). Server-write-only: the
-- public setFacetPayload contract never carries it, so a client cannot forge
-- a "generated" snapshot. NULL for manually-entered or legacy form facets.
ALTER TABLE public.study_facets ADD COLUMN generated_payload JSONB NULL;
