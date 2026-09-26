-- =========================================================================
-- book_part_lemma_counts.primary_occurrences (#476, "Learn before you read").
--
-- `occurrences` credits every guard-surviving reading of an ambiguous form
-- the form's full count (the pinned-book priority asks "will I run into this
-- word"). The book page's word list shows words to a person, so it counts
-- only the occurrences where the lemma is the form's MOST LIKELY (most
-- frequent) reading, so an ambiguous form like «полок» lists one word instead
-- of «полка», «полк» and «полок» side by side.
--
-- NULL on rows written by an older profile build; the builder version bump
-- that ships with this column rebuilds them in the background, and readers
-- fall back to `occurrences` meanwhile. Metadata-only ADD COLUMN, and the
-- CHECK is NOT VALID so it skips scanning the (NULL-only) existing rows.
-- =========================================================================

ALTER TABLE public.book_part_lemma_counts
  ADD COLUMN primary_occurrences INT NULL,
  ADD CONSTRAINT book_part_lemma_counts_primary_occurrences_check
    CHECK (primary_occurrences >= 0 AND primary_occurrences <= occurrences) NOT VALID;
