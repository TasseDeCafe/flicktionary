-- The reader's segment search moved fully client-side
-- (https://github.com/TasseDeCafe/flicktionary/issues/341), which removed the
-- last reader of text_segments.tsv — the sense-relevance prefilter builds its
-- tsvectors on the fly and never read the column. Drop the whole machinery:
-- no more per-insert trigger cost on bulk subtitle import, no GIN index
-- maintenance.
DROP TRIGGER IF EXISTS text_segments_tsv_trigger ON public.text_segments;
DROP FUNCTION IF EXISTS public.text_segments_set_tsv();
DROP INDEX IF EXISTS public.idx_text_segments_tsv;
ALTER TABLE public.text_segments DROP COLUMN IF EXISTS tsv;
