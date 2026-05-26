-- Per-card chat read-state. A card has exactly one owner (via
-- study_session_id -> study_sessions.user_id), so card_id alone is the PK; no
-- per-user dimension is needed. RLS is enabled-but-unused, matching
-- card_chat_messages (filtering is enforced at the app layer).
CREATE TABLE public.card_chat_read_state (
  card_id UUID NOT NULL,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT card_chat_read_state_pkey PRIMARY KEY (card_id),
  CONSTRAINT card_chat_read_state_card_id_fkey FOREIGN KEY (card_id)
    REFERENCES public.cards (id) ON DELETE CASCADE
);
ALTER TABLE public.card_chat_read_state ENABLE ROW LEVEL SECURITY;
