-- Fuzzy vocabulary search (https://github.com/TasseDeCafe/flicktionary/issues/341):
-- unaccent makes the vocabulary-tab substring filter accent-insensitive, and
-- pg_trgm's word_similarity() adds typo tolerance. Both live in the extensions
-- schema (Supabase convention); callers schema-qualify (extensions.unaccent, …)
-- rather than relying on search_path.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
