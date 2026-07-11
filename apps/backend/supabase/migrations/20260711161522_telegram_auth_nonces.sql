-- Single-use sign-in nonces for links the Telegram bot sends to already-paired
-- users (e.g. `/sessions/<id>?auth=<nonce>`).
--
-- Telegram opens links in its in-app browser, which shares no cookies with the
-- user's real browser — so session links used to dead-end on the login screen.
-- Instead, the bot binds a short-lived nonce to the paired user; the web app,
-- when it loads signed-out with an `auth` query param, POSTs the nonce to
-- telegramAuth.exchangeNonce, which consumes it and returns a Supabase
-- magic-link token_hash the client redeems with verifyOtp.
--
-- The nonce is the only credential that sits durably in the chat history, so
-- it is single-use (consume requires consumed_at IS NULL) and short-lived; the
-- Supabase token it buys exists only in transit.

CREATE TABLE public.telegram_auth_nonces (
  nonce UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_auth_nonces_pkey PRIMARY KEY (nonce),
  CONSTRAINT telegram_auth_nonces_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_telegram_auth_nonces_expires_at
  ON public.telegram_auth_nonces (expires_at);

ALTER TABLE public.telegram_auth_nonces ENABLE ROW LEVEL SECURITY;
