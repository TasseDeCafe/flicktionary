import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbTextTrack = Tables<'text_tracks'>
export type TextTrackSource = Database['public']['Enums']['text_track_source']

// 'blocked' exists for tracks moderated AFTER ingest (share-time YouTube
// checks): the gated ingest surfaces reject hard-blocked content before any
// row exists, but an already-ingested track needs the verdict stored so it is
// never re-checked and never published. It does not affect private study.
export type TrackModeration = { status: 'clean' | 'flagged' | 'blocked'; category: string | null }

const insertTextTrack = async (params: {
  contentSourceId: string
  source: TextTrackSource
  language: string
  externalId: string | null
  hash: string
  moderation: TrackModeration | null
}): Promise<DbTextTrack> => {
  const result = (await sql`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash, moderation_status, moderation_category)
    VALUES (
      ${params.contentSourceId},
      ${params.source},
      ${params.language},
      ${params.externalId},
      ${params.hash},
      ${params.moderation?.status ?? null},
      ${params.moderation?.category ?? null}
    )
    RETURNING *
  `) as DbTextTrack[]
  return result[0]!
}

// NULL-repair only: the first verdict wins, so a re-import can fill in a
// verdict for a pre-feature or failed-open track but never overwrite one
// (protects a 'flagged' from being downgraded by a later 'clean').
const backfillModeration = async (trackId: string, moderation: TrackModeration): Promise<void> => {
  await sql`
    UPDATE public.text_tracks
    SET moderation_status = ${moderation.status}, moderation_category = ${moderation.category}
    WHERE id = ${trackId} AND moderation_status IS NULL
  `
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
    moderation: TrackModeration | null
  }) => Promise<DbTextTrack>
  backfillModeration: (trackId: string, moderation: TrackModeration) => Promise<void>
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
    backfillModeration,
    findByContentSourceLanguageAndHash,
    findByContentSourceLanguageAndExternalId,
    findById,
    findByIdWithSourceType,
  }
}
