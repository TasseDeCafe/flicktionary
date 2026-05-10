-- Initial Flicktionary application schema. Sits on top of the
-- create_template_tables migration; everything below is domain-specific
-- (content sources, study sessions, cards, user vocabulary, practice, kaikki
-- reference data). See SPEC.md for the full data model.

-- =========================================================================
-- users (Flicktionary preferences layered onto the template users table)
-- =========================================================================

ALTER TABLE public.users
  ADD COLUMN native_language TEXT NULL,
  ADD COLUMN tap_to_translate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN llm_highlights_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- =========================================================================
-- Flicktionary enums
-- =========================================================================

CREATE TYPE content_source_type AS ENUM ('movie', 'book', 'article', 'text');

CREATE TYPE text_track_source AS ENUM ('opensubtitles', 'upload', 'paste', 'url');

CREATE TYPE study_session_status AS ENUM ('active', 'processing', 'processed', 'exported', 'failed');

CREATE TYPE card_status AS ENUM ('pending', 'kept', 'rejected', 'auto_rejected');

CREATE TYPE card_chat_role AS ENUM ('user', 'assistant');

CREATE TYPE practice_session_status AS ENUM ('active', 'completed', 'abandoned');

CREATE TYPE practice_text_status AS ENUM ('pending', 'generating', 'ready', 'reading', 'done', 'failed');

CREATE TYPE practice_rating AS ENUM ('again', 'hard', 'good', 'easy');

CREATE TYPE srs_state AS ENUM ('new', 'learning', 'review', 'relearning');

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
  CONSTRAINT text_tracks_content_source_language_hash_unique UNIQUE (content_source_id, language, hash),
  CONSTRAINT text_tracks_content_source_id_id_unique UNIQUE (content_source_id, id)
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
    WHEN 'hi' THEN 'hindi'::regconfig
    WHEN 'es' THEN 'spanish'::regconfig
    WHEN 'ar' THEN 'arabic'::regconfig
    WHEN 'fr' THEN 'french'::regconfig
    WHEN 'pt' THEN 'portuguese'::regconfig
    WHEN 'ru' THEN 'russian'::regconfig
    WHEN 'id' THEN 'indonesian'::regconfig
    WHEN 'de' THEN 'german'::regconfig
    WHEN 'tr' THEN 'turkish'::regconfig
    WHEN 'ta' THEN 'tamil'::regconfig
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
  -- Soft-delete: "Remove" hides the session from the user's list but keeps the
  -- underlying content (cards, segments, content_source) so kept vocabulary
  -- can still back-link to the source text. Hard erasure happens via account
  -- deletion (auth.users CASCADE).
  deleted_at TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT study_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT study_sessions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT study_sessions_content_source_id_fkey FOREIGN KEY (content_source_id)
    REFERENCES public.content_sources (id) ON DELETE RESTRICT,
  CONSTRAINT study_sessions_text_track_id_fkey FOREIGN KEY (text_track_id)
    REFERENCES public.text_tracks (id) ON DELETE RESTRICT,
  CONSTRAINT study_sessions_content_source_text_track_fkey
    FOREIGN KEY (content_source_id, text_track_id)
    REFERENCES public.text_tracks (content_source_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_study_sessions_user_created
  ON public.study_sessions (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
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
--
-- A card is a per-session detection event: surface_form is the inflected form
-- as it appeared in the source segment; status is the per-session lifecycle
-- (pending -> kept/rejected/auto_rejected/exported). The vocabulary content
-- (headword, sense, translation, definition, target_example, native_example,
-- exploration_extras) lives on user_lookups and is reached via user_lookup_id.
-- A card_chat_messages thread is per-card-instance.
-- =========================================================================

CREATE TABLE public.cards (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NOT NULL,
  highlight_id UUID NULL,
  segment_id UUID NOT NULL,
  user_lookup_id UUID NOT NULL,
  surface_form TEXT NOT NULL,
  status card_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT cards_pkey PRIMARY KEY (id),
  CONSTRAINT cards_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  CONSTRAINT cards_highlight_id_fkey FOREIGN KEY (highlight_id)
    REFERENCES public.highlights (id) ON DELETE SET NULL,
  CONSTRAINT cards_segment_id_fkey FOREIGN KEY (segment_id)
    REFERENCES public.text_segments (id) ON DELETE RESTRICT
  -- cards_user_lookup_id_fkey is added via ALTER TABLE after user_lookups exists.
);

CREATE INDEX idx_cards_study_session_status ON public.cards (study_session_id, status);
CREATE INDEX idx_cards_highlight_id ON public.cards (highlight_id);
CREATE INDEX idx_cards_user_lookup_id ON public.cards (user_lookup_id);

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
-- user_lookups (canonical vocabulary entry; cross-source dedup; sense
-- disambiguator lets the same headword be studied in multiple distinct
-- senses).
--
-- Owns the vocabulary CONTENT (translation, definition, target_example,
-- native_example, exploration_extras) so edits propagate to every card
-- referencing this row instead of being per-card snapshots. A row is created
-- eagerly the first time a card with this (headword, sense) is detected for
-- the user (see findOrCreate in user-lookups-repository.ts), so the content
-- has a home before the card is "kept".
--
-- exploration_extras is a partial JSONB bag of optional enrichment fields
-- (ipa, frequency, more_frequent_synonym, regionalism, register,
-- register_alternatives, collocations, etymology, l1_notes, notes,
-- context_segment) populated when the user clicks "Generate full
-- exploration". translation and native_example are nullable so L1 = L2
-- sessions can leave them empty and rely on definition instead.
--
-- grammar is a parallel JSONB bag for typed, language-agnostic
-- morphology/grammar facts (pos, gender, aspect, aspect_pair_headword,
-- government, number_only, is_indeclinable, is_reflexive, animacy,
-- display_form, notable_forms, notes). Populated by the basic-data pass
-- and refinable by the enrichment pass. Kept separate from
-- exploration_extras so the renderer can treat grammar facts (chips near
-- the headword, structured editors) differently from learning content
-- (etymology, register, etc.).
--
-- first_card_id points at the originating card (the first detection that
-- created this row). It is set on creation and never updated; it powers the
-- "Open source" navigation in the vocabulary view.
-- =========================================================================

CREATE TABLE public.user_lookups (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  headword TEXT NOT NULL,
  sense TEXT NOT NULL DEFAULT '',
  -- Canonical vocabulary content (formerly on cards):
  translation TEXT NULL,
  definition TEXT NULL,
  target_example TEXT NULL,
  native_example TEXT NULL,
  exploration_extras JSONB NOT NULL DEFAULT '{}'::jsonb,
  grammar JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Set by the wiktionary-grounding step when kaikki data was merged into the
  -- grammar JSONB. NULL means pure LLM (no grounding ran or no entry matched).
  -- Editing a grammar field via the focus view does NOT clear this — the badge
  -- reflects "kaikki was consulted at processing time", not whether the
  -- current value is unedited.
  grounded_at TIMESTAMP WITH TIME ZONE NULL,
  first_card_id UUID NULL,
  exported_at TIMESTAMP WITH TIME ZONE NULL,
  count INTEGER NOT NULL DEFAULT 0,
  -- FSRS state for the Practice tab. Null until the row enters its first
  -- practice session. Stability/difficulty are FSRS-internal and only set
  -- once srs_state is non-null (and after at least one rating).
  srs_state srs_state NULL,
  srs_due TIMESTAMP WITH TIME ZONE NULL,
  srs_stability REAL NULL,
  srs_difficulty REAL NULL,
  srs_last_review TIMESTAMP WITH TIME ZONE NULL,
  srs_reps INTEGER NOT NULL DEFAULT 0,
  srs_lapses INTEGER NOT NULL DEFAULT 0,
  added_to_practice_at TIMESTAMP WITH TIME ZONE NULL,
  -- Soft-delete + creation timestamps for the Vocabulary management view.
  -- deleted_at hides the chunk from the Vocabulary list AND from the Practice
  -- queue. Re-keeping the same headword in a new session revives the row by
  -- clearing deleted_at (see upsertOnKeep).
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT user_lookups_pkey PRIMARY KEY (id),
  CONSTRAINT user_lookups_user_target_headword_sense_unique
    UNIQUE (user_id, target_language, headword, sense),
  CONSTRAINT user_lookups_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT user_lookups_first_card_id_fkey FOREIGN KEY (first_card_id)
    REFERENCES public.cards (id) ON DELETE SET NULL
);

-- All read paths gate on deleted_at IS NULL, so the indexes below are partial
-- on that predicate. The id tiebreaker on the sort indexes gives stable
-- cursor pagination even as srs_due mutates under us during a long scroll.
CREATE INDEX idx_user_lookups_user_target ON public.user_lookups (user_id, target_language)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_user_lookups_due
  ON public.user_lookups (user_id, target_language, srs_due)
  WHERE srs_state IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_user_lookups_recent
  ON public.user_lookups (user_id, target_language, created_at DESC, id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_user_lookups_due_sort
  ON public.user_lookups (user_id, target_language, srs_due ASC NULLS LAST, id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.user_lookups ENABLE ROW LEVEL SECURITY;

-- Now that user_lookups exists, wire the cards.user_lookup_id FK.
ALTER TABLE public.cards
  ADD CONSTRAINT cards_user_lookup_id_fkey
  FOREIGN KEY (user_lookup_id)
  REFERENCES public.user_lookups (id)
  ON DELETE RESTRICT;

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

-- =========================================================================
-- practice_sessions (Practice tab — SRS reading sessions)
--
-- One row per sitting. Spans multiple practice_texts which together cover the
-- user's due chunks for a target language. Status flows active -> completed
-- when the orchestrator finds nothing else due, or active -> abandoned if the
-- user explicitly ends the session early.
-- =========================================================================

CREATE TABLE public.practice_sessions (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  status practice_session_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT practice_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_practice_sessions_user_started
  ON public.practice_sessions (user_id, target_language, started_at DESC);

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- practice_texts (LLM-generated short passages within a practice_session)
--
-- annotations is a JSONB array of:
--   { headword, sense, surface_form, char_start, char_end }
-- Server-validated: body.slice(char_start, char_end) === surface_form, and
-- (headword, sense) was in the requested set. Bad rows dropped at validation.
-- The status field supports the lean MVP (synchronous: pending -> ready) but
-- also the v2 pre-generation path (pending -> generating -> ready -> reading
-- -> done).
-- =========================================================================

CREATE TABLE public.practice_texts (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  practice_session_id UUID NOT NULL,
  ord INTEGER NOT NULL,
  status practice_text_status NOT NULL DEFAULT 'pending',
  body TEXT NULL,
  annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Chunks the LLM declined to embed in this text. Element shape:
  --   { headword, sense, reason }
  -- Used by the next-text generator to detect "stubborn" chunks: if a chunk is
  -- skipped once it gets a one-shot rescue (single-sentence text); skipped
  -- twice and it's excluded from the rest of the session.
  skipped_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  generation_warning TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMP WITH TIME ZONE NULL,
  read_at TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT practice_texts_pkey PRIMARY KEY (id),
  CONSTRAINT practice_texts_session_fkey FOREIGN KEY (practice_session_id)
    REFERENCES public.practice_sessions (id) ON DELETE CASCADE,
  CONSTRAINT practice_texts_session_ord_unique UNIQUE (practice_session_id, ord)
);

CREATE INDEX idx_practice_texts_session_ord
  ON public.practice_texts (practice_session_id, ord);

ALTER TABLE public.practice_texts ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- practice_ratings (audit log of rating events; was_explicit=false for the
-- implicit-good ratings applied on Next-text advance)
-- =========================================================================

CREATE TABLE public.practice_ratings (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  practice_text_id UUID NOT NULL,
  user_lookup_id UUID NOT NULL,
  -- Audit-snapshot columns: captured at rating time and never updated. They
  -- preserve "what the user rated then" even if the underlying user_lookups
  -- row is later renamed.
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  headword TEXT NOT NULL,
  sense TEXT NOT NULL DEFAULT '',
  rating practice_rating NOT NULL,
  was_explicit BOOLEAN NOT NULL DEFAULT FALSE,
  rated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT practice_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT practice_ratings_text_fkey FOREIGN KEY (practice_text_id)
    REFERENCES public.practice_texts (id) ON DELETE CASCADE,
  CONSTRAINT practice_ratings_lookup_fkey FOREIGN KEY (user_lookup_id)
    REFERENCES public.user_lookups (id) ON DELETE CASCADE
);

CREATE INDEX idx_practice_ratings_lookup
  ON public.practice_ratings (user_lookup_id);
CREATE INDEX idx_practice_ratings_text
  ON public.practice_ratings (practice_text_id);

ALTER TABLE public.practice_ratings ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- processing_telemetry — audit trail for backend processing passes (e.g. the
-- exclusion-list pre-filter and the Haiku-tier sense-disambiguation tiebreaker
-- that gate basic-data card creation). Backend-only writes; never queried
-- through PostgREST. Drop this table if telemetry stops being useful.
-- =========================================================================

CREATE TABLE public.processing_telemetry (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NULL,
  pass_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  duration_ms INTEGER NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT processing_telemetry_pkey PRIMARY KEY (id),
  CONSTRAINT processing_telemetry_session_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE
);

CREATE INDEX idx_processing_telemetry_session
  ON public.processing_telemetry (study_session_id, created_at DESC);

ALTER TABLE public.processing_telemetry ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- wiktionary_entries — reference data loaded from kaikki.org dumps. One row
-- per (target_language, headword, pos): a single headword can yield multiple
-- entries when it covers more than one part of speech (e.g. Russian "печь"
-- = both the verb "to bake" and the noun "stove"). The full kaikki record
-- is stored verbatim in `data` so future features (conjugation tables,
-- audio links, etymology, etc.) can read it without re-ingestion. Backend
-- reads only — no RLS policies; the postgres role used by the API bypasses
-- RLS, anon/authed clients have no access.
-- =========================================================================

CREATE TABLE public.wiktionary_entries (
  id BIGSERIAL NOT NULL,
  target_language TEXT NOT NULL,
  headword TEXT NOT NULL,
  pos TEXT NOT NULL,
  data JSONB NOT NULL,
  CONSTRAINT wiktionary_entries_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_wiktionary_entries_lookup
  ON public.wiktionary_entries (target_language, headword);

CREATE INDEX idx_wiktionary_entries_pos
  ON public.wiktionary_entries (target_language, pos);

ALTER TABLE public.wiktionary_entries ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- wiktionary_forms — flattened paradigm-cell index. Maps every inflected
-- form kaikki ships (Russian verbs ship ~80 cells each) back to its lemma
-- entry. Used as a fallback when the LLM-normalized headword doesn't hit a
-- wiktionary_entries row directly (e.g. the LLM produced a form rather than
-- the lemma). Many-to-many: a form can map to multiple entries when it's a
-- homograph across POS or aspect.
-- =========================================================================

CREATE TABLE public.wiktionary_forms (
  target_language TEXT NOT NULL,
  form TEXT NOT NULL,
  entry_id BIGINT NOT NULL,
  CONSTRAINT wiktionary_forms_pkey PRIMARY KEY (target_language, form, entry_id),
  CONSTRAINT wiktionary_forms_entry_fkey FOREIGN KEY (entry_id)
    REFERENCES public.wiktionary_entries (id) ON DELETE CASCADE
);

CREATE INDEX idx_wiktionary_forms_lookup
  ON public.wiktionary_forms (target_language, form);

ALTER TABLE public.wiktionary_forms ENABLE ROW LEVEL SECURITY;
