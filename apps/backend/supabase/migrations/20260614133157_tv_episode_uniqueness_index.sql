-- One content_source per (tmdbShowId, seasonNumber, episodeNumber) for TV
-- episodes. TMDB rows are a shared catalog, so dedup is global (no
-- created_by_user_id) — mirroring the movie model's findByTmdbId — but unlike
-- movies this adds a DB-level guard so concurrent inserts cannot duplicate an
-- episode. References the 'tv' enum value committed in the previous migration.
CREATE UNIQUE INDEX content_sources_tv_episode_unique
  ON public.content_sources (
    (metadata ->> 'tmdbShowId'),
    (metadata ->> 'seasonNumber'),
    (metadata ->> 'episodeNumber')
  )
  WHERE type = 'tv';
