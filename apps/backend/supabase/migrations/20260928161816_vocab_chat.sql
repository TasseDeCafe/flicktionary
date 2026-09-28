-- Vocabulary chat: each thread is its own content_source (type 'chat') with a
-- study_session, so cards added from the chat group under the thread like any
-- other source. A new enum value cannot be referenced as a literal in the
-- migration that adds it; nothing here needs to.
ALTER TYPE public.content_source_type ADD VALUE IF NOT EXISTS 'chat';

-- One row per chat turn. Assistant turns carry the structured output of the
-- model's tools next to the prose:
-- - proposal: the cards proposed via propose_cards, as
--   {"items": [{"headword", "note", "example", "highlightId"}]} where
--   highlightId is set once the item was added (the card is created by the
--   enrichment pipeline from that highlight).
-- - new_thread_suggestion: {"language", "message"} when the learner asked
--   about another target language than the thread's.
CREATE TABLE public.vocab_chat_messages (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NOT NULL,
  role card_chat_role NOT NULL,
  content TEXT NOT NULL,
  proposal JSONB,
  new_thread_suggestion JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT vocab_chat_messages_pkey PRIMARY KEY (id),
  CONSTRAINT vocab_chat_messages_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE
);

CREATE INDEX idx_vocab_chat_messages_session_created ON public.vocab_chat_messages (study_session_id, created_at);

ALTER TABLE public.vocab_chat_messages ENABLE ROW LEVEL SECURITY;
