-- Links a Telegram chat to a Flicktionary account for the ingestion bot.
-- One chat pairs with at most one user (partial unique index); pairing to a
-- new account "steals" the chat id from the previous owner.
--
-- Telegram chat ids are 64-bit integers; postgres.js returns BIGINT columns
-- as strings, so the TS layer treats chat ids as strings.

ALTER TABLE public.users ADD COLUMN telegram_chat_id BIGINT NULL;

CREATE UNIQUE INDEX idx_users_telegram_chat_id
  ON public.users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;
