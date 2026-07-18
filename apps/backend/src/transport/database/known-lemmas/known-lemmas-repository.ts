import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbKnownLemma = Tables<'known_lemmas'>

// Stateless known-vocabulary assertions (docs/DATA-MODEL.md "Known lemmas").
// Lemmas are checkpoint_fold-folded strings; read-time precedence (a live
// saved lookup beats a known mark) lives in the difficulty query, never here.
// Consumers are the difficulty/coverage reads and the gloss-sheet chip ONLY —
// ghost nominations must never read this table.

export type BulkMarkKnownInput = {
  userId: string
  targetLanguage: string
  lemmas: readonly string[]
  source: 'bulk_text'
  // First writer wins (ON CONFLICT DO NOTHING) — single-source provenance.
  sourceId: string | null
  // Sweep-exact undo handle: one fresh uuid per press. A batch only ever owns
  // rows it actually inserted, so delete-by-batch undoes exactly that press.
  sweepBatchId: string | null
}

const bulkMarkKnown = async (input: BulkMarkKnownInput): Promise<number> => {
  if (input.lemmas.length === 0) return 0
  const result = await sql`
    INSERT INTO public.known_lemmas (user_id, target_language, lemma, source, source_id, sweep_batch_id)
    SELECT ${input.userId}, ${input.targetLanguage}, lemma, ${input.source}, ${input.sourceId}, ${input.sweepBatchId}
    FROM unnest(${sql.array([...input.lemmas])}::text[]) AS t(lemma)
    ON CONFLICT DO NOTHING
  `
  return result.count
}

// The subset of `lemmas` the user has marked known.
const filterKnown = async (params: {
  userId: string
  targetLanguage: string
  lemmas: readonly string[]
}): Promise<string[]> => {
  if (params.lemmas.length === 0) return []
  const rows = (await sql`
    SELECT lemma FROM public.known_lemmas
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND lemma = ANY(${sql.array([...params.lemmas])}::text[])
  `) as Array<{ lemma: string }>
  return rows.map((r) => r.lemma)
}

const listLemmas = async (userId: string, targetLanguage: string): Promise<string[]> => {
  const rows = (await sql`
    SELECT lemma FROM public.known_lemmas
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
  `) as Array<{ lemma: string }>
  return rows.map((r) => r.lemma)
}

// Bare DELETE — the un-mark correction path has zero side effects by design.
const deleteByLemmas = async (params: {
  userId: string
  targetLanguage: string
  lemmas: readonly string[]
}): Promise<number> => {
  if (params.lemmas.length === 0) return 0
  const result = await sql`
    DELETE FROM public.known_lemmas
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND lemma = ANY(${sql.array([...params.lemmas])}::text[])
  `
  return result.count
}

// Bulk correction paths for sweep-created rows. No target_language filter —
// the sourceId (a session) already scopes to one language's rows. With a
// sweepBatchId the delete is sweep-exact (the toast Undo); without, it clears
// the whole session's marks (the difficulty-sheet action).
const deleteBySource = async (params: {
  userId: string
  source: 'bulk_text'
  sourceId: string
  sweepBatchId?: string
}): Promise<number> => {
  const result = await sql`
    DELETE FROM public.known_lemmas
    WHERE user_id = ${params.userId}
      AND source = ${params.source}
      AND source_id = ${params.sourceId}
      ${params.sweepBatchId ? sql`AND sweep_batch_id = ${params.sweepBatchId}` : sql``}
  `
  return result.count
}

const countBySource = async (params: { userId: string; source: 'bulk_text'; sourceId: string }): Promise<number> => {
  const rows = (await sql`
    SELECT count(*)::int AS count FROM public.known_lemmas
    WHERE user_id = ${params.userId}
      AND source = ${params.source}
      AND source_id = ${params.sourceId}
  `) as Array<{ count: number }>
  return rows[0]?.count ?? 0
}

export interface KnownLemmasRepositoryInterface {
  bulkMarkKnown: (input: BulkMarkKnownInput) => Promise<number>
  filterKnown: (params: { userId: string; targetLanguage: string; lemmas: readonly string[] }) => Promise<string[]>
  listLemmas: (userId: string, targetLanguage: string) => Promise<string[]>
  deleteByLemmas: (params: { userId: string; targetLanguage: string; lemmas: readonly string[] }) => Promise<number>
  deleteBySource: (params: {
    userId: string
    source: 'bulk_text'
    sourceId: string
    sweepBatchId?: string
  }) => Promise<number>
  countBySource: (params: { userId: string; source: 'bulk_text'; sourceId: string }) => Promise<number>
}

export const KnownLemmasRepository = (): KnownLemmasRepositoryInterface => {
  return {
    bulkMarkKnown,
    filterKnown,
    listLemmas,
    deleteByLemmas,
    deleteBySource,
    countBySource,
  }
}
