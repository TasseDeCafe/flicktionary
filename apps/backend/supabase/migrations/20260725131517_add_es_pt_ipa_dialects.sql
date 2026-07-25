-- Per-language IPA dialect preferences for the two dialect-split languages
-- being added to the Kaikki pipeline, mirroring users.english_ipa_dialect
-- (20260512164750). The values double as the grammar bag's bucket keys:
-- Spanish `cas` (Castilian) / `lam` (Latin American, default — larger learner
-- population), Portuguese `br` (Brazilian, default) / `eu` (European).

ALTER TABLE public.users
  ADD COLUMN spanish_ipa_dialect TEXT NOT NULL DEFAULT 'lam'
  CHECK (spanish_ipa_dialect IN ('cas', 'lam'));

ALTER TABLE public.users
  ADD COLUMN portuguese_ipa_dialect TEXT NOT NULL DEFAULT 'br'
  CHECK (portuguese_ipa_dialect IN ('br', 'eu'));
