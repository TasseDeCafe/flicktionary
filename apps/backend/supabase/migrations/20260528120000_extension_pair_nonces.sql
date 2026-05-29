-- One-time pairing nonces used by the browser-extension auth broker.
--
-- Flow: extension generates a UUID nonce, opens the broker page on the web
-- app, the page calls extensionAuth.mintSession({ nonce }), the server inserts
-- (user_id, nonce, expires_at) here and returns a Supabase admin-generated
-- magic-link token_hash; extension verifies it to mint its own session.
--
-- Each row is single-use: nonces must be deleted (or rejected) once consumed,
-- and the broker rejects any nonce older than expires_at.

CREATE TABLE public.extension_pair_nonces (
  nonce UUID NOT NULL,
  user_id UUID NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  consumed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT extension_pair_nonces_pkey PRIMARY KEY (nonce),
  CONSTRAINT extension_pair_nonces_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_extension_pair_nonces_user_id
  ON public.extension_pair_nonces (user_id);

CREATE INDEX idx_extension_pair_nonces_expires_at
  ON public.extension_pair_nonces (expires_at);

ALTER TABLE public.extension_pair_nonces ENABLE ROW LEVEL SECURITY;
