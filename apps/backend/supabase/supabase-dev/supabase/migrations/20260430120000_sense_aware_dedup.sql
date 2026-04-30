-- Adds a `sense` disambiguator to cards and extends the user_lookups primary
-- key so the same headword can be studied multiple times when its meanings are
-- distinct (polysemy on bare lemmas is the main motivator). Existing rows get
-- sense='' and continue to behave as a single bucket.

ALTER TABLE public.cards
  ADD COLUMN sense TEXT NOT NULL DEFAULT '';

ALTER TABLE public.user_lookups
  ADD COLUMN sense TEXT NOT NULL DEFAULT '';

ALTER TABLE public.user_lookups DROP CONSTRAINT user_lookups_pkey;
ALTER TABLE public.user_lookups
  ADD CONSTRAINT user_lookups_pkey PRIMARY KEY (user_id, target_language, headword, sense);
