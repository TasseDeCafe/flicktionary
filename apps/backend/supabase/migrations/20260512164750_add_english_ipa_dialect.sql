ALTER TABLE public.users
  ADD COLUMN english_ipa_dialect TEXT NOT NULL DEFAULT 'ga'
  CHECK (english_ipa_dialect IN ('ga', 'rp'));
