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

// Idempotent get-or-create for the synthetic adhoc content_source that backs
// the per-(user, language) "Personal vocabulary" pseudo-session. The partial
// unique index `content_sources_adhoc_user_language_unique` makes the upsert
// concurrency-safe; the SELECT fallback handles the case where another caller
// won the conflict and we need to read the existing row.
const findOrCreateAdhoc = async (params: {
  userId: string
  language: string
  title: string
}): Promise<DbContentSource> => {
  // Partial unique indexes can't be referenced by name in ON CONFLICT (the
  // ON CONSTRAINT clause only matches CONSTRAINTs). Use the column-list +
  // WHERE form so Postgres infers the matching partial index instead.
  const inserted = (await sql`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES (
      'adhoc',
      ${params.title},
      ${params.language},
      '{}'::jsonb,
      ${params.userId}
    )
    ON CONFLICT (created_by_user_id, language) WHERE type = 'adhoc'
      DO NOTHING
    RETURNING *
  `) as DbContentSource[]
  if (inserted[0]) return inserted[0]
  const existing = (await sql`
    SELECT *
    FROM public.content_sources
    WHERE type = 'adhoc'
      AND created_by_user_id = ${params.userId}
      AND language = ${params.language}
    LIMIT 1
  `) as DbContentSource[]
  return existing[0]!
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
  findOrCreateAdhoc: (params: { userId: string; language: string; title: string }) => Promise<DbContentSource>
}

export const ContentSourcesRepository = (): ContentSourcesRepositoryInterface => {
  return {
    insertContentSource,
    findById,
    findByTmdbId,
    findOrCreateAdhoc,
  }
}
