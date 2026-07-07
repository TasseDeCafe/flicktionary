-- Lesson-notes import: stored extraction drafts + per-teacher format profiles.
--
-- Flow: paste/upload -> createBatch (idempotent by whole-input hash) ->
-- background extract_lesson job fills import_batch_rows -> confirm screen ->
-- confirmBatch creates the lesson session + highlights and enqueues the
-- standard enrich_highlight jobs. Service-role access only (like
-- telegram_pending_imports): RLS enabled with no policies; all reads/writes go
-- through the backend.

-- User-editable DESCRIPTIVE context injected into the extraction prompt
-- ("column 3 is pronunciation; CAPS marks stress"). Never prescriptive rules —
-- the system prompt owns row-emission guarantees (win/noise rows are always
-- emitted regardless of profile text).
CREATE TABLE public.teacher_profiles (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  profile_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT teacher_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT teacher_profiles_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT teacher_profiles_user_name_unique UNIQUE (user_id, name)
);

CREATE TABLE public.import_batches (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  teacher_profile_id UUID NULL,
  source_title TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  -- sha256 of the client-normalized markdown; the batch identity.
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'extracting'
    CHECK (status IN ('extracting', 'ready', 'failed', 'confirmed')),
  -- The extractor's inferred format description; becomes the stored
  -- teacher profile if the user saves it on confirm.
  format_profile TEXT NULL,
  -- Set at confirm — the lesson session the accepted rows landed in.
  study_session_id UUID NULL,
  error TEXT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT import_batches_pkey PRIMARY KEY (id),
  CONSTRAINT import_batches_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT import_batches_teacher_profile_id_fkey FOREIGN KEY (teacher_profile_id)
    REFERENCES public.teacher_profiles (id) ON DELETE SET NULL,
  CONSTRAINT import_batches_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE SET NULL
);

-- Re-uploading the same text under the same target language resumes the
-- existing draft (or routes to the confirmed batch's session) instead of
-- forking a duplicate. Language is part of the identity — the same text
-- re-uploaded under another target language is a new batch. The teacher
-- profile is deliberately NOT part of it: the profile is descriptive guidance,
-- and editing it must not fork a duplicate draft (re-extraction under a new
-- profile is v2). Failed batches drop out so a retry can start fresh.
CREATE UNIQUE INDEX uq_import_batches_user_lang_hash
  ON public.import_batches (user_id, target_language, input_hash)
  WHERE status <> 'failed';

CREATE INDEX idx_import_batches_expires_at ON public.import_batches (expires_at);

CREATE TABLE public.import_batch_rows (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  batch_id UUID NOT NULL,
  row_index INTEGER NOT NULL,
  -- The extractor row verbatim (sourceText, type, headword, targetForm,
  -- context, wrongForm, stressMark, proposedFacets, confidence, lessonDate).
  payload JSONB NOT NULL,
  lesson_date DATE NULL,
  -- Duplicate resolution, computed by the extract job against the user's
  -- existing vocabulary.
  duplicate_user_lookup_id UUID NULL,
  duplicate_facets JSONB NULL,
  planned_action TEXT NOT NULL
    CHECK (planned_action IN ('create', 'add_facet', 'lapse_and_add_facet', 'skip')),
  -- NULL until confirmBatch records the user's accept/reject decision.
  confirmed BOOLEAN NULL,
  created_card_id UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT import_batch_rows_pkey PRIMARY KEY (id),
  CONSTRAINT import_batch_rows_batch_id_fkey FOREIGN KEY (batch_id)
    REFERENCES public.import_batches (id) ON DELETE CASCADE,
  CONSTRAINT import_batch_rows_duplicate_lookup_fkey FOREIGN KEY (duplicate_user_lookup_id)
    REFERENCES public.user_lookups (id) ON DELETE SET NULL,
  CONSTRAINT import_batch_rows_created_card_fkey FOREIGN KEY (created_card_id)
    REFERENCES public.cards (id) ON DELETE SET NULL,
  CONSTRAINT import_batch_rows_batch_row_unique UNIQUE (batch_id, row_index)
);

ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batch_rows ENABLE ROW LEVEL SECURITY;
