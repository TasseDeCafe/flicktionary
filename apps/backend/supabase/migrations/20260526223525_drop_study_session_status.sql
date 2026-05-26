-- Drop the vestigial study_sessions.status / processed_at lifecycle.
--
-- After the background-enrichment refactor these carry no signal:
--   * Reader sessions enrich continuously and the Process route is a no-op, so
--     they stay 'active' forever and never transition.
--   * The only writer of 'processed' was the ad-hoc session (the "Save to
--     vocabulary" / practice lookup path), which is a hidden structural anchor
--     (cs.type = 'adhoc' is filtered out of the session list) — its status was
--     never displayed or branched on.
--   * 'processing' / 'exported' / 'failed' are no longer written by any code.
-- No code reads either column anymore, so drop both and the now-unused enum.

ALTER TABLE public.study_sessions DROP COLUMN IF EXISTS status;
ALTER TABLE public.study_sessions DROP COLUMN IF EXISTS processed_at;

DROP TYPE IF EXISTS public.study_session_status;
