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

// Existence probe for the guest source quota: mirrors getOrCreateTvEpisode's
// conflict key so the router can tell reuse (always allowed) from creation.
const findTvEpisode = async (params: {
  tmdbShowId: number
  seasonNumber: number
  episodeNumber: number
}): Promise<DbContentSource | null> => {
  const result = (await sql`
    SELECT * FROM public.content_sources
    WHERE type = 'tv'
      AND metadata->>'tmdbShowId' = ${String(params.tmdbShowId)}
      AND metadata->>'seasonNumber' = ${String(params.seasonNumber)}
      AND metadata->>'episodeNumber' = ${String(params.episodeNumber)}
    LIMIT 1
  `) as DbContentSource[]
  return result[0] ?? null
}

const getOrCreateTvEpisode = async (params: {
  title: string
  language: string
  metadata: ContentSourceMetadata
  createdByUserId: string | null
}): Promise<DbContentSource> => {
  const result = (await sql`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES (
      'tv',
      ${params.title},
      ${params.language},
      ${sql.json(params.metadata)},
      ${params.createdByUserId}
    )
    ON CONFLICT (
      (metadata ->> 'tmdbShowId'),
      (metadata ->> 'seasonNumber'),
      (metadata ->> 'episodeNumber')
    )
    WHERE type = 'tv'
    DO UPDATE SET title = public.content_sources.title
    RETURNING *
  `) as DbContentSource[]
  return result[0]!
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
  findTvEpisode: (params: {
    tmdbShowId: number
    seasonNumber: number
    episodeNumber: number
  }) => Promise<DbContentSource | null>
  getOrCreateTvEpisode: (params: {
    title: string
    language: string
    metadata: ContentSourceMetadata
    createdByUserId: string | null
  }) => Promise<DbContentSource>
}

export const ContentSourcesRepository = (): ContentSourcesRepositoryInterface => {
  return {
    insertContentSource,
    findById,
    findByTmdbId,
    findTvEpisode,
    getOrCreateTvEpisode,
  }
}
