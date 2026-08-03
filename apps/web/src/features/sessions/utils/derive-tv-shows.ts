import type { StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export type TvShowEpisode = {
  sessionId: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle: string | null
  createdAt: string
  contentSourceTitle: string | null
  stillUrl: string | null
}

export type TvShowGroup = {
  tmdbShowId: number
  showTitle: string
  originalTitle: string | null
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  language: string
  episodes: TvShowEpisode[]
  latestCreatedAt: string
}

// Collapses the flat session list into one group per TV show, keyed by
// tmdbShowId. Groups are sorted most-recently-active first (latest episode
// createdAt); episodes within a group are sorted by season then episode.
// Non-TV sessions are ignored. The same derivation powers the grouped Sessions
// list, the "recently-added shows" wizard quick-picks, and the "Add episode"
// shortcut's known-episode marks.
export const deriveTvShows = (sessions: StudySession[]): TvShowGroup[] => {
  const groups = new Map<number, TvShowGroup>()

  for (const s of sessions) {
    if (s.contentSourceType !== 'tv' || s.tmdbShowId == null) continue
    if (s.seasonNumber == null || s.episodeNumber == null) continue

    const episode: TvShowEpisode = {
      sessionId: s.id,
      seasonNumber: s.seasonNumber,
      episodeNumber: s.episodeNumber,
      episodeTitle: s.episodeTitle,
      createdAt: s.createdAt,
      contentSourceTitle: s.contentSourceTitle,
      stillUrl: s.contentSourceStillUrl,
    }

    const existing = groups.get(s.tmdbShowId)
    if (existing) {
      existing.episodes.push(episode)
      if (s.createdAt > existing.latestCreatedAt) existing.latestCreatedAt = s.createdAt
    } else {
      groups.set(s.tmdbShowId, {
        tmdbShowId: s.tmdbShowId,
        showTitle: s.showTitle ?? s.contentSourceTitle ?? '',
        originalTitle: s.originalTitle,
        year: s.contentSourceYear,
        posterUrl: s.contentSourcePosterUrl,
        backdropUrl: s.contentSourceBackdropUrl,
        language: s.targetLanguage,
        episodes: [episode],
        latestCreatedAt: s.createdAt,
      })
    }
  }

  const result = [...groups.values()]
  for (const group of result) {
    group.episodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
  }
  result.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt))
  return result
}

// The most recent episode of a group (by createdAt) — the season the "Add
// episode" shortcut seeds, and the basis for "next un-added episode".
export const latestEpisode = (group: TvShowGroup): TvShowEpisode =>
  group.episodes.reduce((latest, ep) => (ep.createdAt > latest.createdAt ? ep : latest), group.episodes[0]!)
