import { sql } from '../postgres-client'
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

export const resolveRegconfig = (language: string): string => LANGUAGE_TO_REGCONFIG[language.toLowerCase()] ?? 'simple'

const bulkInsertSegments = async (textTrackId: string, segments: SegmentInsertInput[]): Promise<void> => {
  if (segments.length === 0) {
    return
  }
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
}

const listByTrackId = async (textTrackId: string): Promise<DbTextSegment[]> => {
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
    ORDER BY index ASC
  `) as DbTextSegment[]
}

const searchInTrack = async (textTrackId: string, language: string, query: string): Promise<DbTextSegment[]> => {
  const cfg = resolveRegconfig(language)
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
      AND tsv @@ plainto_tsquery(${cfg}::regconfig, ${query})
    ORDER BY index ASC
    LIMIT 200
  `) as DbTextSegment[]
}

const findById = async (id: string): Promise<DbTextSegment | null> => {
  const result = (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
    FROM public.text_segments WHERE id = ${id}
  `) as DbTextSegment[]
  return result[0] ?? null
}

const listAroundIndex = async (textTrackId: string, centerIndex: number, radius: number): Promise<DbTextSegment[]> => {
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
      AND index BETWEEN ${centerIndex - radius} AND ${centerIndex + radius}
    ORDER BY index ASC
  `) as DbTextSegment[]
}

// Append a single segment at MAX(index)+1, computed atomically in the
// same INSERT. Used by the adhoc "Add a word" flow where each new entry
// adds one segment to the synthetic per-(user, language) text_track.
// The unique (text_track_id, index) constraint backstops the rare race
// where two concurrent appends compute the same MAX — the loser retries.
const appendSegmentAtomic = async (params: {
  textTrackId: string
  text: string
  startMs: number | null
  endMs: number | null
}): Promise<DbTextSegment> => {
  const result = (await sql`
    INSERT INTO public.text_segments (text_track_id, index, text, start_ms, end_ms)
    SELECT
      ${params.textTrackId},
      COALESCE(MAX(index) + 1, 0),
      ${params.text},
      ${params.startMs},
      ${params.endMs}
    FROM public.text_segments WHERE text_track_id = ${params.textTrackId}
    RETURNING id, text_track_id, index, text, start_ms, end_ms, tsv
  `) as DbTextSegment[]
  return result[0]!
}

export interface TextSegmentsRepositoryInterface {
  bulkInsertSegments: (textTrackId: string, segments: SegmentInsertInput[]) => Promise<void>
  listByTrackId: (textTrackId: string) => Promise<DbTextSegment[]>
  searchInTrack: (textTrackId: string, language: string, query: string) => Promise<DbTextSegment[]>
  findById: (id: string) => Promise<DbTextSegment | null>
  listAroundIndex: (textTrackId: string, centerIndex: number, radius: number) => Promise<DbTextSegment[]>
  appendSegmentAtomic: (params: {
    textTrackId: string
    text: string
    startMs: number | null
    endMs: number | null
  }) => Promise<DbTextSegment>
}

export const TextSegmentsRepository = (): TextSegmentsRepositoryInterface => {
  return {
    bulkInsertSegments,
    listByTrackId,
    searchInTrack,
    findById,
    listAroundIndex,
    appendSegmentAtomic,
  }
}
