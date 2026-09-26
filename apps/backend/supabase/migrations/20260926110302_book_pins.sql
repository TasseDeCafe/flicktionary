-- =========================================================================
-- Pinned-book priority (#476, docs/proposals/book-aware-new-term-priority.md
-- §1 and §4).
--
-- book_pins — at most one pinned book per (user, target language). While a
-- book is pinned, never-introduced recognition terms that occur often in its
-- unread parts get up to half of the daily new-card budget. Pinning another
-- book of the same language replaces the row (upsert on the PK).
--
-- study_facets.book_quota_source_id — stamped at introduction time (both
-- introduction guards) with the pinned book when the term was in that book's
-- stream at that moment. The daily book quota counts these stamps, so the
-- count survives replacing the pin or reading past a word's last occurrence.
-- ON DELETE SET NULL keeps the introduction itself if the book goes away.
-- =========================================================================

CREATE TABLE public.book_pins (
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  content_source_id UUID NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT book_pins_pkey PRIMARY KEY (user_id, target_language),
  CONSTRAINT book_pins_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT book_pins_content_source_id_fkey FOREIGN KEY (content_source_id)
    REFERENCES public.content_sources (id) ON DELETE CASCADE
);

CREATE INDEX idx_book_pins_content_source_id ON public.book_pins (content_source_id);

ALTER TABLE public.book_pins ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.study_facets
  ADD COLUMN book_quota_source_id UUID NULL
    REFERENCES public.content_sources (id) ON DELETE SET NULL;
