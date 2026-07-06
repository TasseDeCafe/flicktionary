-- Pending text imports for the Telegram ingestion bot.
--
-- When a message can't be imported yet (chat not paired, or the user still
-- needs to answer the in-chat CEFR question), the raw message text is stashed
-- here so the import can resume without the user re-sending it. One pending
-- import per chat: a newer message replaces the previous one.
--
-- Rows hold raw user message text (Telegram caps messages at 4096 chars), so
-- they are short-lived: popped atomically on resume and swept after expiry.

CREATE TABLE public.telegram_pending_imports (
  chat_id BIGINT NOT NULL,
  message_text TEXT NOT NULL,
  suggested_title TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_pending_imports_pkey PRIMARY KEY (chat_id)
);

CREATE INDEX idx_telegram_pending_imports_expires_at
  ON public.telegram_pending_imports (expires_at);

ALTER TABLE public.telegram_pending_imports ENABLE ROW LEVEL SECURITY;
