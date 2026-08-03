import { getConfig } from '../../../config/environment-config'
import { UpstreamRateLimitError } from '../upstream-rate-limit-error'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

// TMDB throttles at roughly 40 requests/second per IP and answers 429 — since
// every user's search funnels through this server's single IP, surface it as a
// typed error the boundary maps to our own 429. Exported for unit tests.
export const classifyTmdbFailure = (label: string, response: { status: number; statusText: string }): Error => {
  if (response.status === 429) {
    return new UpstreamRateLimitError('tmdb', 'rate_limited', `TMDB ${label} rate limited (429)`)
  }
  return new Error(`TMDB ${label} failed: ${response.status} ${response.statusText}`)
}
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w342'
// Backdrops are landscape hero images for the 16:9 card media — they need a
// wider size than the portrait posters.
const TMDB_BACKDROP_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w780'

export type TmdbMovie = {
  tmdbId: number
  title: string
  originalTitle: string
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  overview: string
}

type TmdbSearchResponse = {
  results: Array<{
    id: number
    title: string
    original_title: string
    release_date: string | null
    poster_path: string | null
    backdrop_path: string | null
    overview: string
  }>
}

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${getConfig().tmdbApiKey}`,
  'Content-Type': 'application/json',
})

const imageUrl = (path: string | null): string | null => (path ? `${TMDB_IMAGE_BASE_URL}${path}` : null)

export const backdropImageUrl = (path: string | null): string | null =>
  path ? `${TMDB_BACKDROP_IMAGE_BASE_URL}${path}` : null

export const searchMovies = async (query: string, year?: number): Promise<TmdbMovie[]> => {
  const params = new URLSearchParams({ query, include_adult: 'false', language: 'en-US' })
  if (year) params.set('year', String(year))
  const url = `${TMDB_BASE_URL}/search/movie?${params.toString()}`

  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw classifyTmdbFailure('search', response)
  }
  const data = (await response.json()) as TmdbSearchResponse
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.title,
    originalTitle: r.original_title,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    posterUrl: imageUrl(r.poster_path),
    backdropUrl: backdropImageUrl(r.backdrop_path),
    overview: r.overview,
  }))
}

export type TmdbTvShow = {
  tmdbId: number
  title: string
  originalTitle: string
  year: number | null
  posterUrl: string | null
  backdropUrl: string | null
  overview: string
}

type TmdbTvSearchResponse = {
  results: Array<{
    id: number
    name: string
    original_name: string
    first_air_date: string | null
    poster_path: string | null
    backdrop_path: string | null
    overview: string
  }>
}

export const searchTvShows = async (query: string): Promise<TmdbTvShow[]> => {
  const params = new URLSearchParams({ query, include_adult: 'false', language: 'en-US' })
  const url = `${TMDB_BASE_URL}/search/tv?${params.toString()}`

  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw classifyTmdbFailure('TV search', response)
  }
  const data = (await response.json()) as TmdbTvSearchResponse
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.name,
    originalTitle: r.original_name,
    year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
    posterUrl: imageUrl(r.poster_path),
    backdropUrl: backdropImageUrl(r.backdrop_path),
    overview: r.overview,
  }))
}

export type TmdbSeason = {
  seasonNumber: number
  name: string
  episodeCount: number
  posterUrl: string | null
}

type TmdbTvDetailsResponse = {
  seasons: Array<{
    season_number: number
    name: string
    episode_count: number
    poster_path: string | null
  }>
}

// Season 0 ("Specials") is excluded from the picker for a cleaner MVP list.
export const getTvSeasons = async (tmdbId: number): Promise<TmdbSeason[]> => {
  const url = `${TMDB_BASE_URL}/tv/${tmdbId}?language=en-US`
  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw classifyTmdbFailure('TV details', response)
  }
  const data = (await response.json()) as TmdbTvDetailsResponse
  return data.seasons
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      posterUrl: imageUrl(s.poster_path),
    }))
}

export type TmdbEpisode = {
  episodeNumber: number
  name: string
  overview: string
  stillUrl: string | null
}

type TmdbSeasonDetailsResponse = {
  episodes: Array<{
    episode_number: number
    name: string
    overview: string
    still_path: string | null
  }>
}

export const getTvEpisodes = async (tmdbId: number, seasonNumber: number): Promise<TmdbEpisode[]> => {
  const url = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}?language=en-US`
  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw classifyTmdbFailure('TV season', response)
  }
  const data = (await response.json()) as TmdbSeasonDetailsResponse
  return data.episodes.map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name,
    overview: e.overview,
    stillUrl: imageUrl(e.still_path),
  }))
}
