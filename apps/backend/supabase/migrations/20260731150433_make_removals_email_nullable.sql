-- Anonymous (guest) accounts have no email, but they can still delete their
-- account. Relax the NOT NULL so the removals audit row records email = NULL
-- for guests instead of the deletion 500ing.
ALTER TABLE public.removals
  ALTER COLUMN email DROP NOT NULL;
