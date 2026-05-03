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

const findById = async (id: string): Promise<DbTextTrack | null> => {
  const result = (await sql`
    SELECT * FROM public.text_tracks WHERE id = ${id}
  `) as DbTextTrack[]
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
  findById: (id: string) => Promise<DbTextTrack | null>
}

export const TextTracksRepository = (): TextTracksRepositoryInterface => {
  return {
    insertTextTrack,
    findByContentSourceLanguageAndHash,
    findById,
  }
}
