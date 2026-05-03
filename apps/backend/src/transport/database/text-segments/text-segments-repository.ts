import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables } from '../database.public.types'

export type DbTextSegment = Tables<'text_segments'>

export type SegmentInsertInput = {
  index: number
  text: string
  startMs: number | null
  endMs: number | null
}

// Languages whose Postgres regconfigs we use for FTS query parsing.
// Limited to SUPPORTED_LANGUAGES entries that have a built-in Snowball stemmer
// shipped with Postgres — see the authoritative list in the Postgres source:
// https://github.com/postgres/postgres/blob/master/src/backend/snowball/Makefile
// Languages outside this set (zh, bn, ur, ja, sw, mr, te, vi, ko) need external
// tokenizer extensions and fall back to 'simple' so exact-token lookups still work.
// To add support for a new language, update BOTH this map AND the
// text_segments_set_tsv() trigger in the schema migration (they must mirror each
// other exactly), then ship a migration that re-runs CREATE OR REPLACE FUNCTION
// and rebuilds tsv for any pre-existing rows in the newly-supported language.
const LANGUAGE_TO_REGCONFIG: Record<string, string> = {
  en: 'english',
  hi: 'hindi',
  es: 'spanish',
  ar: 'arabic',
  fr: 'french',
  pt: 'portuguese',
  ru: 'russian',
  id: 'indonesian',
  de: 'german',
  tr: 'turkish',
  ta: 'tamil',
}

const resolveRegconfig = (language: string): string => LANGUAGE_TO_REGCONFIG[language.toLowerCase()] ?? 'simple'

const bulkInsertSegments = async (textTrackId: string, segments: SegmentInsertInput[]): Promise<boolean> => {
  if (segments.length === 0) {
    return true
  }
  try {
    const rows = segments.map((s) => ({
      text_track_id: textTrackId,
      index: s.index,
      text: s.text,
      start_ms: s.startMs,
      end_ms: s.endMs,
    }))
    await sql`
      INSERT INTO public.text_segments ${sql(rows, 'text_track_id', 'index', 'text', 'start_ms', 'end_ms')}
    `
    return true
  } catch (e) {
    logCustomErrorMessageAndError(`bulkInsertSegments, textTrackId = ${textTrackId}`, e)
    return false
  }
}

const listByTrackId = async (textTrackId: string): Promise<DbTextSegment[]> => {
  try {
    const result = (await sql`
      SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
      FROM public.text_segments
      WHERE text_track_id = ${textTrackId}
      ORDER BY index ASC
    `) as DbTextSegment[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`textSegments.listByTrackId, textTrackId = ${textTrackId}`, e)
    return []
  }
}

const searchInTrack = async (textTrackId: string, language: string, query: string): Promise<DbTextSegment[]> => {
  try {
    const cfg = resolveRegconfig(language)
    const result = (await sql`
      SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
      FROM public.text_segments
      WHERE text_track_id = ${textTrackId}
        AND tsv @@ plainto_tsquery(${cfg}::regconfig, ${query})
      ORDER BY index ASC
      LIMIT 200
    `) as DbTextSegment[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`textSegments.searchInTrack, textTrackId = ${textTrackId}, q = ${query}`, e)
    return []
  }
}

const findById = async (id: string): Promise<DbTextSegment | null> => {
  try {
    const result = (await sql`
      SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
      FROM public.text_segments WHERE id = ${id}
    `) as DbTextSegment[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`textSegments.findById, id = ${id}`, e)
    return null
  }
}

const listAroundIndex = async (textTrackId: string, centerIndex: number, radius: number): Promise<DbTextSegment[]> => {
  try {
    const result = (await sql`
      SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
      FROM public.text_segments
      WHERE text_track_id = ${textTrackId}
        AND index BETWEEN ${centerIndex - radius} AND ${centerIndex + radius}
      ORDER BY index ASC
    `) as DbTextSegment[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`textSegments.listAroundIndex, textTrackId = ${textTrackId}`, e)
    return []
  }
}

export interface TextSegmentsRepositoryInterface {
  bulkInsertSegments: (textTrackId: string, segments: SegmentInsertInput[]) => Promise<boolean>
  listByTrackId: (textTrackId: string) => Promise<DbTextSegment[]>
  searchInTrack: (textTrackId: string, language: string, query: string) => Promise<DbTextSegment[]>
  findById: (id: string) => Promise<DbTextSegment | null>
  listAroundIndex: (textTrackId: string, centerIndex: number, radius: number) => Promise<DbTextSegment[]>
}

export const TextSegmentsRepository = (): TextSegmentsRepositoryInterface => {
  return {
    bulkInsertSegments,
    listByTrackId,
    searchInTrack,
    findById,
    listAroundIndex,
  }
}
