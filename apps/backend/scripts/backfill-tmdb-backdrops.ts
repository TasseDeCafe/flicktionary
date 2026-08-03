import postgres from 'postgres'
import { resolveConnectionString, maskConnectionString } from './db-connection'

// One-off backfill for the unified media cards: movie/TV content_sources
// created before backdrops were captured only carry a posterUrl. Re-query TMDB
// by the stored tmdbId / tmdbShowId and write the missing landscape images
// into metadata — backdropUrl for movies and shows, stillUrl per TV episode.
// Rows that already have a backdropUrl are skipped, so re-running is cheap.
//
// Usage (TMDB_API_KEY comes from Doppler):
//   cd apps/backend && doppler run -- npx tsx scripts/backfill-tmdb-backdrops.ts
//   ... add --dry-run to only print what would change.

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const BACKDROP_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w780'
const STILL_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w342'

const apiKey = process.env.TMDB_API_KEY ?? ''

const tmdbGet = async <T>(path: string): Promise<T | null> => {
  const response = await fetch(`${TMDB_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`TMDB ${path} failed: ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

type DbRow = { id: string; type: string; metadata: Record<string, unknown> }

const asInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

const main = async (): Promise<void> => {
  if (!apiKey) throw new Error('TMDB_API_KEY is not set — run under doppler from apps/backend')
  const dryRun = process.argv.includes('--dry-run')
  const connectionString = resolveConnectionString()
  console.log(`DB: ${maskConnectionString(connectionString)}${dryRun ? ' (dry run)' : ''}`)
  const sql = postgres(connectionString)

  try {
    const rows = await sql<DbRow[]>`
      SELECT id, type, metadata
      FROM public.content_sources
      WHERE type IN ('movie', 'tv')
        AND (metadata->>'backdropUrl' IS NULL OR (type = 'tv' AND metadata->>'stillUrl' IS NULL))
    `
    console.log(`${rows.length} movie/tv sources missing backdrop or still`)

    // Cache TMDB responses across rows: one show details per show, one season
    // details per show+season — many episode rows share both.
    const showBackdrops = new Map<number, string | null>()
    const seasonStills = new Map<string, Map<number, string | null>>()

    let updated = 0
    for (const row of rows) {
      const patch: Record<string, string> = {}

      if (row.type === 'movie') {
        const tmdbId = asInt(row.metadata.tmdbId)
        if (tmdbId === null) continue
        const details = await tmdbGet<{ backdrop_path: string | null }>(`/movie/${tmdbId}`)
        if (details?.backdrop_path) patch.backdropUrl = `${BACKDROP_IMAGE_BASE_URL}${details.backdrop_path}`
      } else {
        const showId = asInt(row.metadata.tmdbShowId)
        const seasonNumber = asInt(row.metadata.seasonNumber)
        const episodeNumber = asInt(row.metadata.episodeNumber)
        if (showId === null) continue

        if (!showBackdrops.has(showId)) {
          const details = await tmdbGet<{ backdrop_path: string | null }>(`/tv/${showId}`)
          showBackdrops.set(showId, details?.backdrop_path ?? null)
        }
        const backdropPath = showBackdrops.get(showId) ?? null
        if (row.metadata.backdropUrl == null && backdropPath) {
          patch.backdropUrl = `${BACKDROP_IMAGE_BASE_URL}${backdropPath}`
        }

        if (row.metadata.stillUrl == null && seasonNumber !== null && episodeNumber !== null) {
          const seasonKey = `${showId}:${seasonNumber}`
          if (!seasonStills.has(seasonKey)) {
            const season = await tmdbGet<{ episodes: Array<{ episode_number: number; still_path: string | null }> }>(
              `/tv/${showId}/season/${seasonNumber}`
            )
            seasonStills.set(
              seasonKey,
              new Map((season?.episodes ?? []).map((e) => [e.episode_number, e.still_path]))
            )
          }
          const stillPath = seasonStills.get(seasonKey)?.get(episodeNumber) ?? null
          if (stillPath) patch.stillUrl = `${STILL_IMAGE_BASE_URL}${stillPath}`
        }
      }

      if (Object.keys(patch).length === 0) continue
      updated++
      const title = typeof row.metadata.originalTitle === 'string' ? row.metadata.originalTitle : row.id
      console.log(`  ${row.type} ${title}: ${Object.keys(patch).join(' + ')}`)
      if (!dryRun) {
        await sql`
          UPDATE public.content_sources
          SET metadata = metadata || ${sql.json(patch)}
          WHERE id = ${row.id}
        `
      }
    }

    console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${updated} of ${rows.length} sources.`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
