import type postgres from 'postgres'
import { sql } from '../postgres-client'
import { CITATION_FORM } from '../study-facets/study-facets-repository'

// The pinned book per (user, target language) — docs/SRS.md §4 "Pinned book".
// At most one per language; pinning another book of the same language
// replaces the row.

export type DbBookPin = { content_source_id: string; target_language: string; pinned_at: string }

const getPin = async (userId: string, targetLanguage: string): Promise<DbBookPin | null> => {
  const rows = (await sql`
    SELECT content_source_id, target_language, pinned_at FROM public.book_pins
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `) as DbBookPin[]
  return rows[0] ?? null
}

const upsertPin = async (params: {
  userId: string
  targetLanguage: string
  contentSourceId: string
}): Promise<void> => {
  await sql`
    INSERT INTO public.book_pins (user_id, target_language, content_source_id)
    VALUES (${params.userId}, ${params.targetLanguage}, ${params.contentSourceId})
    ON CONFLICT (user_id, target_language) DO UPDATE
      SET content_source_id = EXCLUDED.content_source_id, pinned_at = now()
  `
}

// Unpins the book only if it is the one pinned — a stale unpin can never
// remove a newer pin of another book.
const deletePinForSource = async (
  params: { userId: string; contentSourceId: string },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    DELETE FROM public.book_pins
    WHERE user_id = ${params.userId} AND content_source_id = ${params.contentSourceId}
  `
}

// Citation introductions made today for any pinned book's stream (the
// introduction guards stamp book_quota_source_id) — the daily quota's usage.
const countBookIntroductionsToday = async (userId: string, targetLanguage: string): Promise<number> => {
  const rows = (await sql`
    SELECT COUNT(*)::int AS count
    FROM public.study_facets f
    JOIN public.user_lookups ul ON ul.id = f.user_lookup_id
    WHERE ul.user_id = ${userId}
      AND ul.target_language = ${targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      AND f.target_form = ${CITATION_FORM}
      AND f.book_quota_source_id IS NOT NULL
      AND f.introduced_at >= CURRENT_DATE
      AND f.introduced_at < CURRENT_DATE + INTERVAL '1 day'
  `) as Array<{ count: number }>
  return rows[0]?.count ?? 0
}

export interface BookPinsRepositoryInterface {
  getPin: (userId: string, targetLanguage: string) => Promise<DbBookPin | null>
  upsertPin: (params: { userId: string; targetLanguage: string; contentSourceId: string }) => Promise<void>
  deletePinForSource: (params: { userId: string; contentSourceId: string }, executor?: postgres.Sql) => Promise<void>
  countBookIntroductionsToday: (userId: string, targetLanguage: string) => Promise<number>
}

export const BookPinsRepository = (): BookPinsRepositoryInterface => {
  return {
    getPin,
    upsertPin,
    deletePinForSource,
    countBookIntroductionsToday,
  }
}
