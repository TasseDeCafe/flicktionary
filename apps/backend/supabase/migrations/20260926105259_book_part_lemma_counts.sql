-- =========================================================================
-- Per-part lemma occurrence counts for books (#476,
-- docs/proposals/book-aware-new-term-priority.md §2) — the input of the
-- pinned-book "occurrences ahead" priority.
--
-- Derived from the part's lemma profile at build time, in the same
-- transaction as the profile swap: each token group runs through the
-- checkpoint homograph guard (applyFrequencyAsymmetryGuard), then every
-- surviving candidate lemma is credited the group's full token_count.
-- Written for book parts only.
--
-- text_tracks.profile_version — the profile builder's logic version. A
-- stamped profile with an older (or NULL) version is served as-is while a
-- rebuild is enqueued in the background; this is how profiles built before
-- the digit-hyphen skip and before the book counts existed catch up.
-- =========================================================================

CREATE TABLE public.book_part_lemma_counts (
  text_track_id UUID NOT NULL,
  lemma TEXT NOT NULL,
  occurrences INT NOT NULL,
  CONSTRAINT book_part_lemma_counts_pkey PRIMARY KEY (text_track_id, lemma),
  CONSTRAINT book_part_lemma_counts_text_track_id_fkey FOREIGN KEY (text_track_id)
    REFERENCES public.text_tracks (id) ON DELETE CASCADE,
  CONSTRAINT book_part_lemma_counts_occurrences_check CHECK (occurrences > 0)
);

-- The queue-time lookup is lemma-driven (a user's candidate lemmas across the
-- pinned book's remaining parts).
CREATE INDEX idx_book_part_lemma_counts_lemma ON public.book_part_lemma_counts (lemma, text_track_id);

ALTER TABLE public.book_part_lemma_counts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.text_tracks ADD COLUMN profile_version INT NULL;
