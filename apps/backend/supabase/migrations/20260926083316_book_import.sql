-- Book import: one content_source(type='book') per uploaded book, one text_track
-- per readable part (a chapter, or a slice of an over-long chapter), one
-- study_session per part created lazily when the part is first opened.

-- Part ordering + display title. NULL on every non-book track.
ALTER TABLE public.text_tracks
  ADD COLUMN book_part_index INTEGER NULL,
  ADD COLUMN book_part_title TEXT NULL;

CREATE UNIQUE INDEX text_tracks_book_part_unique
  ON public.text_tracks (content_source_id, book_part_index)
  WHERE book_part_index IS NOT NULL;

-- Last time the reader advanced or set the position in this session. Drives the
-- book's "current part" (the part session read most recently) so a book reopens
-- where it was left on any device. NULL = never read.
ALTER TABLE public.study_sessions
  ADD COLUMN last_read_at TIMESTAMPTZ NULL;

-- One book source per (user, normalized book text hash): re-uploading the same
-- file resolves to the existing book. No 'book' rows exist yet, so this index is
-- safe by construction.
CREATE UNIQUE INDEX content_sources_book_user_content_hash_unique
  ON public.content_sources (created_by_user_id, (metadata ->> 'contentHash'))
  WHERE type = 'book';
