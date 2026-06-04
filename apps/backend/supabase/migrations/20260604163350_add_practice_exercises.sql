-- =========================================================================
-- practice_exercises: durable pre-generated exercise bank
--
-- One row per generated exercise instance for a (user_lookup, pool). Slots go
-- pending -> generating -> ready -> used (or failed), mirroring the
-- practice_texts fencing lifecycle: a generation_token minted at claim time
-- fences out crashed/raced workers' late writes.
--
-- Consumption model (consume-on-answer): a 'ready' exercise is only stamped
-- used when an answer is SUBMITTED, never when served. Refresh/abandon before
-- answering re-serves the same row (deterministic lowest-created selection) —
-- no bank drain. Every answered attempt consumes its row, so the next attempt
-- always gets a fresh exercise (anti-gaming for rehab gates).
--
-- payload shapes by exercise_type (answer fields are stripped before serving):
--   mc_cloze         {sentence, blankStart, blankEnd, answer, options[4], answerIndex}
--   mc_comprehension {sentence, prompt, options[4], answerIndex}
--   production_cloze {sentence, blankStart, blankEnd, answer, acceptedForms[]}
--   use_in_sentence  {prompt, term}
--
-- gate_eligible marks exercises whose grading is fully deterministic (the MC
-- and production types). LLM-graded use_in_sentence is bonus-only — a grading
-- error must never block a leech graduation.
-- =========================================================================

CREATE TYPE public.exercise_type AS ENUM ('mc_cloze', 'mc_comprehension', 'production_cloze', 'use_in_sentence');
CREATE TYPE public.exercise_status AS ENUM ('pending', 'generating', 'ready', 'used', 'failed');

CREATE TABLE public.practice_exercises (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_lookup_id     uuid NOT NULL REFERENCES public.user_lookups(id) ON DELETE CASCADE,
  target_language    text NOT NULL,
  pool               text NOT NULL CHECK (pool IN ('passive', 'active')),
  exercise_type      public.exercise_type NOT NULL,
  status             public.exercise_status NOT NULL DEFAULT 'pending',
  generation_token   uuid,
  payload            jsonb,
  gate_eligible      boolean NOT NULL DEFAULT false,
  seen_at            timestamptz,
  used_at            timestamptz,
  generation_warning text,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  ready_at           timestamptz
);

-- Bank lookups: "next ready exercise for this (term, pool, type)".
CREATE INDEX practice_exercises_bank_idx
  ON public.practice_exercises (user_lookup_id, pool, status);

-- Strengthen-session sweeps per (user, language, pool).
CREATE INDEX practice_exercises_user_lang_idx
  ON public.practice_exercises (user_id, target_language, pool);

-- Same posture as practice_texts: RLS enabled with no policies. All access
-- goes through the backend's service role; anon/authenticated direct access
-- is blocked.
ALTER TABLE public.practice_exercises ENABLE ROW LEVEL SECURITY;
