-- Reading mode (LLM-generated practice texts) is gone: drop its storage.
-- Rating events keep their rows (implicit reading goods stay valid SRS and
-- streak history); only the link back to the text goes. All fast DDL — no
-- table rewrite.

ALTER TABLE public.practice_rating_events
  DROP CONSTRAINT practice_rating_events_text_fkey,
  DROP COLUMN practice_text_id;

DROP TABLE public.practice_texts;

DROP TYPE public.practice_text_status;
