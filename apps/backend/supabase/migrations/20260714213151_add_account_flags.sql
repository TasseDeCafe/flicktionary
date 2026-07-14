-- Account-level write-once UI facts (checklist dismissal/completion, hint
-- dismissals, "has ever installed the extension"). A text[] set so future
-- flags are a contract enum extension, not a migration. Allowed values are
-- enforced by the API contract (AccountFlagSchema), not the database.
ALTER TABLE public.users
  ADD COLUMN account_flags text[] NOT NULL DEFAULT '{}';
