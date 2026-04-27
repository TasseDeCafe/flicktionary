-- Flicktionary domain tables
-- See SPEC.md for the full data model.

-- =========================================================================
-- Enums
-- =========================================================================

CREATE TYPE content_source_type AS ENUM ('movie', 'book', 'article', 'text');

CREATE TYPE text_track_source AS ENUM ('opensubtitles', 'upload', 'paste', 'url');

CREATE TYPE study_session_status AS ENUM ('active', 'processing', 'processed', 'exported', 'failed');

CREATE TYPE card_status AS ENUM ('pending', 'kept', 'rejected', 'auto_rejected');

CREATE TYPE card_chat_role AS ENUM ('user', 'assistant');

-- =========================================================================
-- Extend users with Flicktionary preferences
-- =========================================================================

ALTER TABLE public.users
  ADD COLUMN native_language TEXT NULL,
  ADD COLUMN tap_to_translate_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- =========================================================================
-- content_sources
-- =========================================================================

CREATE TABLE public.content_sources (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  type content_source_type NOT NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT content_sources_pkey PRIMARY KEY (id),
  CONSTRAINT content_sources_created_by_user_id_fkey FOREIGN KEY (created_by_user_id)
    REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX idx_content_sources_created_by_user_id ON public.content_sources (created_by_user_id);

ALTER TABLE public.content_sources ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- text_tracks
-- =========================================================================

CREATE TABLE public.text_tracks (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  content_source_id UUID NOT NULL,
  source text_track_source NOT NULL,
  language TEXT NOT NULL,
  external_id TEXT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT text_tracks_pkey PRIMARY KEY (id),
  CONSTRAINT text_tracks_content_source_id_fkey FOREIGN KEY (content_source_id)
    REFERENCES public.content_sources (id) ON DELETE CASCADE,
  CONSTRAINT text_tracks_hash_unique UNIQUE (hash)
);

CREATE INDEX idx_text_tracks_content_source_id ON public.text_tracks (content_source_id);

ALTER TABLE public.text_tracks ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- text_segments (with tsv full-text search column populated by trigger)
-- =========================================================================

CREATE TABLE public.text_segments (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  text_track_id UUID NOT NULL,
  index INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_ms INTEGER NULL,
  end_ms INTEGER NULL,
  tsv TSVECTOR NULL,
  CONSTRAINT text_segments_pkey PRIMARY KEY (id),
  CONSTRAINT text_segments_text_track_id_fkey FOREIGN KEY (text_track_id)
    REFERENCES public.text_tracks (id) ON DELETE CASCADE,
  CONSTRAINT text_segments_track_index_unique UNIQUE (text_track_id, index)
);

CREATE INDEX idx_text_segments_track_index ON public.text_segments (text_track_id, index);
CREATE INDEX idx_text_segments_tsv ON public.text_segments USING GIN (tsv);

ALTER TABLE public.text_segments ENABLE ROW LEVEL SECURITY;

-- The track's language is unknown at column-definition time, so the regconfig
-- is resolved per-row from the parent text_tracks.language. Languages outside
-- the mapped set fall back to 'simple', which still lets exact-token lookups work.
CREATE OR REPLACE FUNCTION public.text_segments_set_tsv()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_language TEXT;
  v_cfg regconfig;
BEGIN
  SELECT language INTO v_language FROM public.text_tracks WHERE id = NEW.text_track_id;
  v_cfg := CASE LOWER(COALESCE(v_language, ''))
    WHEN 'en' THEN 'english'::regconfig
    WHEN 'fr' THEN 'french'::regconfig
    WHEN 'de' THEN 'german'::regconfig
    WHEN 'es' THEN 'spanish'::regconfig
    WHEN 'it' THEN 'italian'::regconfig
    WHEN 'pt' THEN 'portuguese'::regconfig
    WHEN 'nl' THEN 'dutch'::regconfig
    WHEN 'ru' THEN 'russian'::regconfig
    ELSE 'simple'::regconfig
  END;
  NEW.tsv := to_tsvector(v_cfg, NEW.text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER text_segments_tsv_trigger
BEFORE INSERT OR UPDATE OF text, text_track_id ON public.text_segments
FOR EACH ROW EXECUTE FUNCTION public.text_segments_set_tsv();

-- =========================================================================
-- study_sessions
-- =========================================================================

CREATE TABLE public.study_sessions (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  content_source_id UUID NOT NULL,
  text_track_id UUID NOT NULL,
  native_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  cefr_level TEXT NOT NULL,
  context_blob TEXT NULL,
  status study_session_status NOT NULL DEFAULT 'active',
  processing_warnings TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT study_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT study_sessions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT study_sessions_content_source_id_fkey FOREIGN KEY (content_source_id)
    REFERENCES public.content_sources (id) ON DELETE RESTRICT,
  CONSTRAINT study_sessions_text_track_id_fkey FOREIGN KEY (text_track_id)
    REFERENCES public.text_tracks (id) ON DELETE RESTRICT
);

CREATE INDEX idx_study_sessions_user_created ON public.study_sessions (user_id, created_at DESC);
CREATE INDEX idx_study_sessions_text_track_id ON public.study_sessions (text_track_id);

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- highlights
-- =========================================================================

CREATE TABLE public.highlights (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NOT NULL,
  start_segment_id UUID NOT NULL,
  end_segment_id UUID NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  selection_text TEXT NOT NULL,
  note TEXT NULL,
  preset_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  fast_gloss TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT highlights_pkey PRIMARY KEY (id),
  CONSTRAINT highlights_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  CONSTRAINT highlights_start_segment_id_fkey FOREIGN KEY (start_segment_id)
    REFERENCES public.text_segments (id) ON DELETE RESTRICT,
  CONSTRAINT highlights_end_segment_id_fkey FOREIGN KEY (end_segment_id)
    REFERENCES public.text_segments (id) ON DELETE RESTRICT
);

CREATE INDEX idx_highlights_study_session_id ON public.highlights (study_session_id);

ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- cards
-- =========================================================================

CREATE TABLE public.cards (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NOT NULL,
  highlight_id UUID NULL,
  segment_id UUID NOT NULL,
  headword TEXT NOT NULL,
  surface_form TEXT NOT NULL,
  full_exploration JSONB NOT NULL DEFAULT '{}'::jsonb,
  status card_status NOT NULL DEFAULT 'pending',
  front_override TEXT NULL,
  back_override TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT cards_pkey PRIMARY KEY (id),
  CONSTRAINT cards_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  CONSTRAINT cards_highlight_id_fkey FOREIGN KEY (highlight_id)
    REFERENCES public.highlights (id) ON DELETE SET NULL,
  CONSTRAINT cards_segment_id_fkey FOREIGN KEY (segment_id)
    REFERENCES public.text_segments (id) ON DELETE RESTRICT
);

CREATE INDEX idx_cards_study_session_status ON public.cards (study_session_id, status);
CREATE INDEX idx_cards_highlight_id ON public.cards (highlight_id);

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- card_chat_messages
-- =========================================================================

CREATE TABLE public.card_chat_messages (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  card_id UUID NOT NULL,
  role card_chat_role NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT card_chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT card_chat_messages_card_id_fkey FOREIGN KEY (card_id)
    REFERENCES public.cards (id) ON DELETE CASCADE
);

CREATE INDEX idx_card_chat_messages_card_id_created ON public.card_chat_messages (card_id, created_at);

ALTER TABLE public.card_chat_messages ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- user_lookups (cross-source dedup)
-- =========================================================================

CREATE TABLE public.user_lookups (
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  headword TEXT NOT NULL,
  first_card_id UUID NULL,
  exported_at TIMESTAMP WITH TIME ZONE NULL,
  count INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT user_lookups_pkey PRIMARY KEY (user_id, target_language, headword),
  CONSTRAINT user_lookups_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT user_lookups_first_card_id_fkey FOREIGN KEY (first_card_id)
    REFERENCES public.cards (id) ON DELETE SET NULL
);

CREATE INDEX idx_user_lookups_user_target ON public.user_lookups (user_id, target_language);

ALTER TABLE public.user_lookups ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- l1_interference_notes (shared across users)
-- =========================================================================

CREATE TABLE public.l1_interference_notes (
  l1_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT l1_interference_notes_pkey PRIMARY KEY (l1_language, target_language)
);

ALTER TABLE public.l1_interference_notes ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- user_target_language_prefs
-- =========================================================================

CREATE TABLE public.user_target_language_prefs (
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  cefr_level TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT user_target_language_prefs_pkey PRIMARY KEY (user_id, target_language),
  CONSTRAINT user_target_language_prefs_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.user_target_language_prefs ENABLE ROW LEVEL SECURITY;
