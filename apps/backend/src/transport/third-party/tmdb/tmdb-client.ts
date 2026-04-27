import { getConfig } from '../../../config/environment-config'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w342'

export type TmdbMovie = {
  tmdbId: number
  title: string
  originalTitle: string
  year: number | null
  posterUrl: string | null
  overview: string
}

type TmdbSearchResponse = {
  results: Array<{
    id: number
    title: string
    original_title: string
    release_date: string | null
    poster_path: string | null
    overview: string
  }>
}

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${getConfig().tmdbApiKey}`,
  'Content-Type': 'application/json',
})

export const searchMovies = async (query: string, year?: number): Promise<TmdbMovie[]> => {
  const params = new URLSearchParams({ query, include_adult: 'false', language: 'en-US' })
  if (year) params.set('year', String(year))
  const url = `${TMDB_BASE_URL}/search/movie?${params.toString()}`

  const response = await fetch(url, { headers: headers() })
  if (!response.ok) {
    throw new Error(`TMDB search failed: ${response.status} ${response.statusText}`)
  }
  const data = (await response.json()) as TmdbSearchResponse
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.title,
    originalTitle: r.original_title,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    posterUrl: r.poster_path ? `${TMDB_IMAGE_BASE_URL}${r.poster_path}` : null,
    overview: r.overview,
  }))
}
