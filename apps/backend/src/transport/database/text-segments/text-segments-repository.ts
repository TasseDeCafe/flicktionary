import type postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbTextSegment = Tables<'text_segments'>

export type SegmentInsertInput = {
  index: number
  text: string
  startMs: number | null
  endMs: number | null
}

// Languages whose Postgres regconfigs we use for FTS query parsing — consumed
// by the sense-relevance prefilter in user-lookups, which builds its
// tsvectors on the fly from segment text.
// Limited to SUPPORTED_LANGUAGES entries that have a built-in Snowball stemmer
// shipped with Postgres — see the authoritative list in the Postgres source:
// https://github.com/postgres/postgres/blob/master/src/backend/snowball/Makefile
// Languages outside this set (zh, bn, ur, ja, sw, mr, te, vi, ko) need external
// tokenizer extensions and fall back to 'simple' so exact-token lookups still work.
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
    SELECT id, text_track_id, index, text, start_ms, end_ms
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
    ORDER BY index ASC
  `) as DbTextSegment[]
}

// First `limit` segments by index — a representative opening slice for context
// blob generation, without loading the whole track (matters for long reads).
const listFirstByTrackId = async (textTrackId: string, limit: number): Promise<DbTextSegment[]> => {
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
    ORDER BY index ASC
    LIMIT ${limit}
  `) as DbTextSegment[]
}

const findById = async (id: string): Promise<DbTextSegment | null> => {
  const result = (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms
    FROM public.text_segments WHERE id = ${id}
  `) as DbTextSegment[]
  return result[0] ?? null
}

// Segments whose track-relative index falls in [startIndex, endIndex] inclusive —
// the DB-windowed fetch behind reading-window nomination (does NOT load the whole
// track, so it scales to long reads / a future book reader).
const listByIndexRange = async (
  textTrackId: string,
  startIndex: number,
  endIndex: number
): Promise<DbTextSegment[]> => {
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
      AND index BETWEEN ${startIndex} AND ${endIndex}
    ORDER BY index ASC
  `) as DbTextSegment[]
}

// Keyset page over a track's segments in index order: rows with
// index > afterIndex (null starts from the beginning), optionally bounded by
// index <= toIndexInclusive. The profile build and the mark-known span sweep
// page with this instead of stepping through the index space — indices are
// client-supplied on extension ingest and not guaranteed dense, so a sparse
// or crafted max index must cost pages of real rows, not empty range queries.
const listPageAfterIndex = async (params: {
  textTrackId: string
  afterIndex: number | null
  limit: number
  toIndexInclusive?: number
}): Promise<DbTextSegment[]> => {
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms
    FROM public.text_segments
    WHERE text_track_id = ${params.textTrackId}
      AND index > ${params.afterIndex ?? -1}
      ${params.toIndexInclusive === undefined ? sql`` : sql`AND index <= ${params.toIndexInclusive}`}
    ORDER BY index ASC
    LIMIT ${params.limit}
  `) as DbTextSegment[]
}

// The track's real maximum segment index, or null for an empty track. The
// checkpoint collector clamps client-supplied indexes to this so a crafted
// large index can't burn the monotonic reviewed-until pointer past the end.
const getMaxIndexForTrack = async (textTrackId: string): Promise<number | null> => {
  const rows = (await sql`
    SELECT MAX(index)::int AS max_index
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
  `) as Array<{ max_index: number | null }>
  return rows[0]?.max_index ?? null
}

// Count + max index in one read — the lemma-profile staleness check compares
// both against the profile's stored bookkeeping.
const getSegmentStats = async (textTrackId: string): Promise<{ segmentCount: number; maxIndex: number | null }> => {
  const rows = (await sql`
    SELECT COUNT(*)::int AS segment_count, MAX(index)::int AS max_index
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
  `) as Array<{ segment_count: number; max_index: number | null }>
  return { segmentCount: rows[0]?.segment_count ?? 0, maxIndex: rows[0]?.max_index ?? null }
}

const listAroundIndex = async (textTrackId: string, centerIndex: number, radius: number): Promise<DbTextSegment[]> => {
  return (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms
    FROM public.text_segments
    WHERE text_track_id = ${textTrackId}
      AND index BETWEEN ${centerIndex - radius} AND ${centerIndex + radius}
    ORDER BY index ASC
  `) as DbTextSegment[]
}

// Append a single segment at MAX(index)+1. The transaction-scoped advisory
// lock serializes appenders for the same text_track so concurrent ad-hoc
// submissions cannot collide on the unique (text_track_id, index) constraint.
// Pass `executor` (a transaction handle) to append inside a caller-owned
// transaction — the advisory lock is xact-scoped either way.
const appendSegmentAtomic = async (
  params: {
    textTrackId: string
    text: string
    startMs: number | null
    endMs: number | null
  },
  executor?: postgres.Sql
): Promise<DbTextSegment> => {
  const run = async (tx: postgres.Sql): Promise<DbTextSegment> => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${`text_segment_append:${params.textTrackId}`}))
    `
    const result = (await tx`
      INSERT INTO public.text_segments (text_track_id, index, text, start_ms, end_ms)
      SELECT
        ${params.textTrackId},
        COALESCE(MAX(index) + 1, 0),
        ${params.text},
        ${params.startMs},
        ${params.endMs}
      FROM public.text_segments WHERE text_track_id = ${params.textTrackId}
      RETURNING id, text_track_id, index, text, start_ms, end_ms
    `) as DbTextSegment[]
    return result[0]!
  }
  return executor ? await run(executor) : await beginTx(run)
}

export interface TextSegmentsRepositoryInterface {
  bulkInsertSegments: (textTrackId: string, segments: SegmentInsertInput[]) => Promise<void>
  listByTrackId: (textTrackId: string) => Promise<DbTextSegment[]>
  listFirstByTrackId: (textTrackId: string, limit: number) => Promise<DbTextSegment[]>
  findById: (id: string) => Promise<DbTextSegment | null>
  listByIndexRange: (textTrackId: string, startIndex: number, endIndex: number) => Promise<DbTextSegment[]>
  listPageAfterIndex: (params: {
    textTrackId: string
    afterIndex: number | null
    limit: number
    toIndexInclusive?: number
  }) => Promise<DbTextSegment[]>
  getMaxIndexForTrack: (textTrackId: string) => Promise<number | null>
  getSegmentStats: (textTrackId: string) => Promise<{ segmentCount: number; maxIndex: number | null }>
  listAroundIndex: (textTrackId: string, centerIndex: number, radius: number) => Promise<DbTextSegment[]>
  appendSegmentAtomic: (
    params: {
      textTrackId: string
      text: string
      startMs: number | null
      endMs: number | null
    },
    executor?: postgres.Sql
  ) => Promise<DbTextSegment>
}

export const TextSegmentsRepository = (): TextSegmentsRepositoryInterface => {
  return {
    bulkInsertSegments,
    listByTrackId,
    listFirstByTrackId,
    findById,
    listByIndexRange,
    listPageAfterIndex,
    getMaxIndexForTrack,
    getSegmentStats,
    listAroundIndex,
    appendSegmentAtomic,
  }
}
