-- One-time pairing nonces for the Telegram ingestion bot.
--
-- Direction is the REVERSE of extension_pair_nonces: the backend mints a nonce
-- bound to a Telegram chat when an unpaired chat messages the bot, and replies
-- with a web link `/telegram-pair?nonce=<uuid>`. The (authenticated) web page
-- then calls telegramPair.claim({ nonce }), which atomically marks the nonce
-- claimed and writes the chat id onto that user.
--
-- Each row is single-use (claim requires claimed_by IS NULL) and expires; the
-- bot reuses a live unclaimed nonce per chat instead of minting duplicates.

CREATE TABLE public.telegram_pair_nonces (
  nonce UUID NOT NULL DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  claimed_by UUID NULL,
  claimed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_pair_nonces_pkey PRIMARY KEY (nonce),
  CONSTRAINT telegram_pair_nonces_claimed_by_fkey FOREIGN KEY (claimed_by)
    REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX idx_telegram_pair_nonces_chat_id
  ON public.telegram_pair_nonces (chat_id);

CREATE INDEX idx_telegram_pair_nonces_expires_at
  ON public.telegram_pair_nonces (expires_at);

ALTER TABLE public.telegram_pair_nonces ENABLE ROW LEVEL SECURITY;
