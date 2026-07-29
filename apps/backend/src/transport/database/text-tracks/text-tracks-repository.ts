import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbTextTrack = Tables<'text_tracks'>
export type TextTrackSource = Database['public']['Enums']['text_track_source']

const insertTextTrack = async (params: {
  contentSourceId: string
  source: TextTrackSource
  language: string
  externalId: string | null
  hash: string
}): Promise<DbTextTrack> => {
  const result = (await sql`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
    VALUES (
      ${params.contentSourceId},
      ${params.source},
      ${params.language},
      ${params.externalId},
      ${params.hash}
    )
    RETURNING *
  `) as DbTextTrack[]
  return result[0]!
}

const findByContentSourceLanguageAndHash = async (params: {
  contentSourceId: string
  language: string
  hash: string
}): Promise<DbTextTrack | null> => {
  const result = (await sql`
    SELECT *
    FROM public.text_tracks
    WHERE content_source_id = ${params.contentSourceId}
      AND language = ${params.language}
      AND hash = ${params.hash}
  `) as DbTextTrack[]
  return result[0] ?? null
}

// external_id is only meaningful within one source's namespace (for
// opensubtitles it's the file_id), so the source is part of the key. Lets the
// OpenSubtitles import skip the quota-counted download for a file we already
// ingested for this content source + language.
const findByContentSourceLanguageAndExternalId = async (params: {
  contentSourceId: string
  source: TextTrackSource
  language: string
  externalId: string
}): Promise<DbTextTrack | null> => {
  const result = (await sql`
    SELECT *
    FROM public.text_tracks
    WHERE content_source_id = ${params.contentSourceId}
      AND source = ${params.source}
      AND language = ${params.language}
      AND external_id = ${params.externalId}
  `) as DbTextTrack[]
  return result[0] ?? null
}

const findById = async (id: string): Promise<DbTextTrack | null> => {
  const result = (await sql`
    SELECT * FROM public.text_tracks WHERE id = ${id}
  `) as DbTextTrack[]
  return result[0] ?? null
}

export type ContentSourceType = Database['public']['Enums']['content_source_type']
export type DbTextTrackWithSourceType = DbTextTrack & { content_source_type: ContentSourceType }

// Track + its content source's type in one read — the lemma-profile gates
// (adhoc/lesson tracks are synthetic, never profiled) need both.
const findByIdWithSourceType = async (id: string): Promise<DbTextTrackWithSourceType | null> => {
  const result = (await sql`
    SELECT t.*, cs.type AS content_source_type
    FROM public.text_tracks t
    JOIN public.content_sources cs ON cs.id = t.content_source_id
    WHERE t.id = ${id}
  `) as DbTextTrackWithSourceType[]
  return result[0] ?? null
}

export interface TextTracksRepositoryInterface {
  insertTextTrack: (params: {
    contentSourceId: string
    source: TextTrackSource
    language: string
    externalId: string | null
    hash: string
  }) => Promise<DbTextTrack>
  findByContentSourceLanguageAndHash: (params: {
    contentSourceId: string
    language: string
    hash: string
  }) => Promise<DbTextTrack | null>
  findByContentSourceLanguageAndExternalId: (params: {
    contentSourceId: string
    source: TextTrackSource
    language: string
    externalId: string
  }) => Promise<DbTextTrack | null>
  findById: (id: string) => Promise<DbTextTrack | null>
  findByIdWithSourceType: (id: string) => Promise<DbTextTrackWithSourceType | null>
}

export const TextTracksRepository = (): TextTracksRepositoryInterface => {
  return {
    insertTextTrack,
    findByContentSourceLanguageAndHash,
    findByContentSourceLanguageAndExternalId,
    findById,
    findByIdWithSourceType,
  }
}
