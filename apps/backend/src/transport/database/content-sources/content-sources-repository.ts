import postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbContentSource = Tables<'content_sources'>
export type ContentSourceType = Database['public']['Enums']['content_source_type']

export type ContentSourceMetadata = { readonly [key: string]: postgres.JSONValue | undefined }

const insertContentSource = async (params: {
  type: ContentSourceType
  title: string
  language: string
  metadata: ContentSourceMetadata
  createdByUserId: string | null
}): Promise<DbContentSource> => {
  const result = (await sql`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES (
      ${params.type},
      ${params.title},
      ${params.language},
      ${sql.json(params.metadata)},
      ${params.createdByUserId}
    )
    RETURNING *
  `) as DbContentSource[]
  return result[0]!
}

const findById = async (id: string): Promise<DbContentSource | null> => {
  const result = (await sql`
    SELECT * FROM public.content_sources WHERE id = ${id}
  `) as DbContentSource[]
  return result[0] ?? null
}

const findByTmdbId = async (tmdbId: number): Promise<DbContentSource | null> => {
  const result = (await sql`
    SELECT * FROM public.content_sources
    WHERE type = 'movie' AND metadata->>'tmdbId' = ${String(tmdbId)}
    LIMIT 1
  `) as DbContentSource[]
  return result[0] ?? null
}

// Global dedup (mirrors findByTmdbId): TMDB rows are a shared catalog, so one
// content_source per (show, season, episode) is reused across users.
const findTvEpisode = async (
  tmdbShowId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<DbContentSource | null> => {
  const result = (await sql`
    SELECT * FROM public.content_sources
    WHERE type = 'tv'
      AND metadata->>'tmdbShowId' = ${String(tmdbShowId)}
      AND metadata->>'seasonNumber' = ${String(seasonNumber)}
      AND metadata->>'episodeNumber' = ${String(episodeNumber)}
    LIMIT 1
  `) as DbContentSource[]
  return result[0] ?? null
}

export interface ContentSourcesRepositoryInterface {
  insertContentSource: (params: {
    type: ContentSourceType
    title: string
    language: string
    metadata: ContentSourceMetadata
    createdByUserId: string | null
  }) => Promise<DbContentSource>
  findById: (id: string) => Promise<DbContentSource | null>
  findByTmdbId: (tmdbId: number) => Promise<DbContentSource | null>
  findTvEpisode: (tmdbShowId: number, seasonNumber: number, episodeNumber: number) => Promise<DbContentSource | null>
}

export const ContentSourcesRepository = (): ContentSourcesRepositoryInterface => {
  return {
    insertContentSource,
    findById,
    findByTmdbId,
    findTvEpisode,
  }
}
