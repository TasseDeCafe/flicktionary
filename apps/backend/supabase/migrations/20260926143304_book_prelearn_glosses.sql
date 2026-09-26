-- =========================================================================
-- "Learn before you read" glosses (#476,
-- docs/proposals/book-aware-new-term-priority.md §6).
--
-- The book page lists frequent words in the chapters ahead, each with its
-- first upcoming occurrence. A short Haiku gloss of the word IN THAT
-- SENTENCE is generated once and kept here. The occurrence is part of the
-- key because a book can use one word in several senses: the gloss always
-- describes the same sentence a "Learn" card would be built from, and once
-- the reader moves past it the next occurrence gets its own gloss.
--
-- gloss_language — the learner's native language, or the target language
-- when translation fields are hidden (the gloss is then a definition).
-- =========================================================================

CREATE TABLE public.book_prelearn_glosses (
  content_source_id UUID NOT NULL,
  lemma TEXT NOT NULL,
  text_segment_id UUID NOT NULL,
  gloss_language TEXT NOT NULL,
  gloss TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT book_prelearn_glosses_pkey PRIMARY KEY (content_source_id, lemma, text_segment_id, gloss_language),
  CONSTRAINT book_prelearn_glosses_content_source_id_fkey FOREIGN KEY (content_source_id)
    REFERENCES public.content_sources (id) ON DELETE CASCADE,
  CONSTRAINT book_prelearn_glosses_text_segment_id_fkey FOREIGN KEY (text_segment_id)
    REFERENCES public.text_segments (id) ON DELETE CASCADE
);

-- Segment deletes cascade through the FK; without this index each one would
-- scan the table.
CREATE INDEX idx_book_prelearn_glosses_text_segment_id ON public.book_prelearn_glosses (text_segment_id);

ALTER TABLE public.book_prelearn_glosses ENABLE ROW LEVEL SECURITY;
