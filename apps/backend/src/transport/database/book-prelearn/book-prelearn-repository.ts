import { sql } from '../postgres-client'
import {
  bookPositionCtesSql,
  lemmaOccurrencesAheadSql,
  MIN_BOOK_OCCURRENCES_AHEAD,
} from '../../../service/practice/book-priority'

// "Learn before you read" (docs/READER-SPEC.md, book page): frequent lemmas in
// the chapters ahead that the user neither knows nor has saved, plus the
// per-occurrence gloss cache (book_prelearn_glosses).

export type PrelearnHorizon = 'next_part' | 'rest_of_book'

export type DbPrelearnCandidate = {
  lemma: string
  // Estimated occurrences within the horizon (the current part pro-rated).
  ahead: number
}

export type PrelearnCandidates = {
  candidates: DbPrelearnCandidate[]
  // Lemmas that pass every filter but match a live saved lookup: already in
  // the user's vocabulary, so the book stream handles them.
  savedCount: number
}

// Counts use primary_occurrences (the lemma as its form's most likely reading;
// `occurrences` until a stale part is rebuilt), so an ambiguous form lists one
// word. Eligibility is judged on the WHOLE rest of the book (a card created
// from the list must qualify for the pinned-book stream, whatever the
// horizon; primary ≤ full counts, so it does), the display count on the
// horizon. Never listed: unranked lemmas (junk homographs, archaisms the rank
// build doesn't know) and lemmas the dictionary only knows as names.
//
// Ordering is book-specific first: occurrences ahead × √rank. Most accounts
// have marked few words as known, and plain occurrence order would open on
// из/их/от; the weighting sinks everyday words without hiding any of them
// (a weaker reader must still see the core words they're missing).
const listCandidates = async (params: {
  userId: string
  contentSourceId: string
  targetLanguage: string
  horizon: PrelearnHorizon
  limit: number
}): Promise<PrelearnCandidates> => {
  const inHorizon = params.horizon === 'next_part' ? sql`t.book_part_index <= bp.idx + 1` : sql`TRUE`
  const primary = sql`COALESCE(c.primary_occurrences, c.occurrences)`
  const rows = (await sql`
    WITH ${bookPositionCtesSql(params.userId, params.contentSourceId)},
    lemma_ahead AS (
      SELECT c.lemma,
        SUM(${lemmaOccurrencesAheadSql(primary)}) AS ahead_all,
        SUM(CASE WHEN ${inHorizon} THEN ${lemmaOccurrencesAheadSql(primary)} ELSE 0 END) AS ahead_h
      FROM public.book_part_lemma_counts c
      JOIN public.text_tracks t ON t.id = c.text_track_id
      CROSS JOIN book_pos bp
      WHERE t.content_source_id = ${params.contentSourceId}
        AND t.book_part_index >= bp.idx
      GROUP BY c.lemma
    ),
    saved_keys AS (
      SELECT DISTINCT k.lemma
      FROM public.user_lookups ul
      CROSS JOIN LATERAL unnest(public.user_headword_lemma_keys(ul.headword, ul.target_language)) AS k(lemma)
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.count > 0
        AND ul.deleted_at IS NULL
    ),
    eligible AS (
      SELECT la.lemma, la.ahead_h, r.rank,
        EXISTS (SELECT 1 FROM saved_keys sk WHERE sk.lemma = la.lemma) AS saved
      FROM lemma_ahead la
      JOIN public.lemma_ranks r ON r.target_language = ${params.targetLanguage} AND r.lemma = la.lemma
      WHERE la.ahead_all >= ${MIN_BOOK_OCCURRENCES_AHEAD}
        AND la.ahead_h > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.known_lemmas kl
          WHERE kl.user_id = ${params.userId}
            AND kl.target_language = ${params.targetLanguage}
            AND kl.lemma = la.lemma
        )
        AND EXISTS (
          SELECT 1 FROM public.wiktionary_entries e
          WHERE e.target_language = ${params.targetLanguage}
            AND public.checkpoint_fold(e.headword, e.target_language) = la.lemma
            AND e.pos <> 'name'
            AND e.data ? 'head_templates'
            AND NOT (e.data->'senses'->0 ? 'form_of')
            AND NOT (e.data->'senses'->0 ? 'alt_of')
        )
    ),
    listed AS (
      SELECT lemma, ahead_h, ahead_h * sqrt(rank) AS score FROM eligible
      WHERE NOT saved
      ORDER BY score DESC, lemma
      LIMIT ${params.limit}
    )
    SELECT lemma, ahead_h::float8 AS ahead, score::float8 AS score, NULL::int AS saved_count FROM listed
    UNION ALL
    SELECT NULL, NULL, NULL, (SELECT count(*)::int FROM eligible WHERE saved)
  `) as Array<{ lemma: string | null; ahead: number | null; score: number | null; saved_count: number | null }>
  let savedCount = 0
  const listed: Array<DbPrelearnCandidate & { score: number }> = []
  for (const row of rows) {
    if (row.lemma === null) savedCount = row.saved_count ?? 0
    else listed.push({ lemma: row.lemma, ahead: Number(row.ahead), score: Number(row.score) })
  }
  // UNION ALL keeps no order guarantee; restore the listing order.
  listed.sort((a, b) => b.score - a.score || (a.lemma < b.lemma ? -1 : 1))
  return { candidates: listed.map(({ lemma, ahead }) => ({ lemma, ahead })), savedCount }
}

export type DbLemmaPart = { lemma: string; textTrackId: string; partIndex: number }

// Every part at or after `fromPartIndex` in which each lemma occurs as its
// form's most likely reading, in reading order — the context scan walks these
// until it finds an occurrence.
const listLemmaParts = async (params: {
  contentSourceId: string
  lemmas: readonly string[]
  fromPartIndex: number
}): Promise<DbLemmaPart[]> => {
  if (params.lemmas.length === 0) return []
  const rows = (await sql`
    SELECT c.lemma, t.id AS text_track_id, t.book_part_index
    FROM public.book_part_lemma_counts c
    JOIN public.text_tracks t ON t.id = c.text_track_id
    WHERE t.content_source_id = ${params.contentSourceId}
      AND t.book_part_index >= ${params.fromPartIndex}
      AND c.lemma = ANY(${sql.array([...params.lemmas])}::text[])
      AND COALESCE(c.primary_occurrences, c.occurrences) > 0
    ORDER BY t.book_part_index, c.lemma
  `) as Array<{ lemma: string; text_track_id: string; book_part_index: number }>
  return rows.map((r) => ({ lemma: r.lemma, textTrackId: r.text_track_id, partIndex: r.book_part_index }))
}

// The subset of `lemmas` that occur somewhere in the book: write paths only
// accept lemmas the list could have offered.
const filterBookLemmas = async (params: { contentSourceId: string; lemmas: readonly string[] }): Promise<string[]> => {
  if (params.lemmas.length === 0) return []
  const rows = (await sql`
    SELECT DISTINCT c.lemma
    FROM public.book_part_lemma_counts c
    JOIN public.text_tracks t ON t.id = c.text_track_id
    WHERE t.content_source_id = ${params.contentSourceId}
      AND c.lemma = ANY(${sql.array([...params.lemmas])}::text[])
  `) as Array<{ lemma: string }>
  return rows.map((r) => r.lemma)
}

// The subset of `segmentIds` belonging to the book's parts.
const filterBookSegments = async (params: {
  contentSourceId: string
  segmentIds: readonly string[]
}): Promise<string[]> => {
  if (params.segmentIds.length === 0) return []
  const rows = (await sql`
    SELECT s.id
    FROM public.text_segments s
    JOIN public.text_tracks t ON t.id = s.text_track_id
    WHERE t.content_source_id = ${params.contentSourceId}
      AND s.id = ANY(${sql.array([...params.segmentIds])}::uuid[])
  `) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

export type DbPrelearnGloss = { lemma: string; textSegmentId: string; gloss: string }

const listGlosses = async (params: {
  contentSourceId: string
  glossLanguage: string
  lemmas: readonly string[]
}): Promise<DbPrelearnGloss[]> => {
  if (params.lemmas.length === 0) return []
  const rows = (await sql`
    SELECT lemma, text_segment_id, gloss
    FROM public.book_prelearn_glosses
    WHERE content_source_id = ${params.contentSourceId}
      AND gloss_language = ${params.glossLanguage}
      AND lemma = ANY(${sql.array([...params.lemmas])}::text[])
  `) as Array<{ lemma: string; text_segment_id: string; gloss: string }>
  return rows.map((r) => ({ lemma: r.lemma, textSegmentId: r.text_segment_id, gloss: r.gloss }))
}

const insertGlosses = async (params: {
  contentSourceId: string
  glossLanguage: string
  glosses: readonly DbPrelearnGloss[]
}): Promise<void> => {
  if (params.glosses.length === 0) return
  await sql`
    INSERT INTO public.book_prelearn_glosses (content_source_id, lemma, text_segment_id, gloss_language, gloss)
    SELECT ${params.contentSourceId}, g.lemma, g.text_segment_id, ${params.glossLanguage}, g.gloss
    FROM unnest(
      ${sql.array(params.glosses.map((g) => g.lemma))}::text[],
      ${sql.array(params.glosses.map((g) => g.textSegmentId))}::uuid[],
      ${sql.array(params.glosses.map((g) => g.gloss))}::text[]
    ) AS g(lemma, text_segment_id, gloss)
    ON CONFLICT DO NOTHING
  `
}

// Whether a lookup's headword keys cover `lemma` — the drift check after a
// "Learn": a card whose headword the basic-data pass changed no longer
// matches the book word.
const lookupCoversLemma = async (params: { userLookupId: string; lemma: string }): Promise<boolean> => {
  const rows = (await sql`
    SELECT ${params.lemma} = ANY(public.user_headword_lemma_keys(ul.headword, ul.target_language)) AS covers
    FROM public.user_lookups ul
    WHERE ul.id = ${params.userLookupId}
  `) as Array<{ covers: boolean }>
  return rows[0]?.covers ?? false
}

export interface BookPrelearnRepositoryInterface {
  listCandidates: typeof listCandidates
  listLemmaParts: typeof listLemmaParts
  filterBookLemmas: typeof filterBookLemmas
  filterBookSegments: typeof filterBookSegments
  listGlosses: typeof listGlosses
  insertGlosses: typeof insertGlosses
  lookupCoversLemma: typeof lookupCoversLemma
}

export const BookPrelearnRepository = (): BookPrelearnRepositoryInterface => ({
  listCandidates,
  listLemmaParts,
  filterBookLemmas,
  filterBookSegments,
  listGlosses,
  insertGlosses,
  lookupCoversLemma,
})
