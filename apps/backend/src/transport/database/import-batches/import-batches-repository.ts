import type postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables } from '../database.public.types'

export type DbImportBatch = Tables<'import_batches'>
export type DbImportBatchRow = Tables<'import_batch_rows'>
export type ImportBatchStatus = 'extracting' | 'ready' | 'failed' | 'confirmed'

// Drafts are short-lived working state; confirmed batches are kept (they carry
// rating-event provenance and the batch -> session pointer).
const DRAFT_TTL_DAYS = 30

export type InsertBatchInput = {
  userId: string
  targetLanguage: string
  teacherProfileId: string | null
  sourceTitle: string
  rawText: string
  inputHash: string
}

export type InsertBatchRowInput = {
  batchId: string
  rowIndex: number
  payload: Record<string, unknown>
  lessonDate: string | null
  duplicateUserLookupId: string | null
  duplicateFacets: Record<string, unknown> | null
  plannedAction: 'create' | 'add_facet' | 'lapse_and_add_facet' | 'skip'
}

// Insert a fresh draft. Returns null when the partial unique index fired — an
// existing non-failed batch already owns this (user, language, hash); the
// caller re-selects it (resume semantics).
const insertBatch = async (params: InsertBatchInput, executor: postgres.Sql = sql): Promise<DbImportBatch | null> => {
  const result = (await executor`
    INSERT INTO public.import_batches (
      user_id, target_language, teacher_profile_id, source_title, raw_text, input_hash, status, expires_at
    )
    VALUES (
      ${params.userId},
      ${params.targetLanguage},
      ${params.teacherProfileId},
      ${params.sourceTitle},
      ${params.rawText},
      ${params.inputHash},
      'extracting',
      NOW() + make_interval(days => ${DRAFT_TTL_DAYS})
    )
    ON CONFLICT (user_id, target_language, input_hash) WHERE status <> 'failed'
    DO NOTHING
    RETURNING *
  `) as DbImportBatch[]
  return result[0] ?? null
}

const findByHashForUser = async (params: {
  userId: string
  targetLanguage: string
  inputHash: string
}): Promise<DbImportBatch | null> => {
  const result = (await sql`
    SELECT * FROM public.import_batches
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND input_hash = ${params.inputHash}
      AND status <> 'failed'
  `) as DbImportBatch[]
  return result[0] ?? null
}

const findByIdForUser = async (id: string, userId: string): Promise<DbImportBatch | null> => {
  const result = (await sql`
    SELECT * FROM public.import_batches
    WHERE id = ${id} AND user_id = ${userId}
  `) as DbImportBatch[]
  return result[0] ?? null
}

// Worker-side read: the extract job addresses the batch by id alone (the job
// row carries the user).
const findById = async (id: string): Promise<DbImportBatch | null> => {
  const result = (await sql`
    SELECT * FROM public.import_batches WHERE id = ${id}
  `) as DbImportBatch[]
  return result[0] ?? null
}

// Guarded status claim — the confirm handler's idempotency gate. Zero rows
// means the batch is not 'ready' (double-submit, still extracting, or already
// confirmed); the caller maps that to a conflict.
const claimForConfirm = async (
  params: { batchId: string; userId: string },
  executor: postgres.Sql = sql
): Promise<DbImportBatch | null> => {
  const result = (await executor`
    UPDATE public.import_batches
    SET status = 'confirmed'
    WHERE id = ${params.batchId}
      AND user_id = ${params.userId}
      AND status = 'ready'
    RETURNING *
  `) as DbImportBatch[]
  return result[0] ?? null
}

const markReady = async (
  params: { batchId: string; formatProfile: string | null },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    UPDATE public.import_batches
    SET status = 'ready', format_profile = ${params.formatProfile}, error = NULL
    WHERE id = ${params.batchId} AND status = 'extracting'
  `
}

const markFailed = async (params: { batchId: string; error: string }): Promise<void> => {
  await sql`
    UPDATE public.import_batches
    SET status = 'failed', error = ${params.error}
    WHERE id = ${params.batchId} AND status = 'extracting'
  `
}

const setStudySessionId = async (
  params: { batchId: string; studySessionId: string },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    UPDATE public.import_batches
    SET study_session_id = ${params.studySessionId}
    WHERE id = ${params.batchId}
  `
}

// Replace-all row write: the extract job is retryable, so it recomputes the
// full row set and swaps it in atomically with the status flip to 'ready'.
const replaceRows = async (
  params: { batchId: string; rows: InsertBatchRowInput[] },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`DELETE FROM public.import_batch_rows WHERE batch_id = ${params.batchId}`
  for (const row of params.rows) {
    await executor`
      INSERT INTO public.import_batch_rows (
        batch_id, row_index, payload, lesson_date,
        duplicate_user_lookup_id, duplicate_facets, planned_action
      )
      VALUES (
        ${row.batchId},
        ${row.rowIndex},
        ${sql.json(row.payload as unknown as postgres.JSONValue)},
        ${row.lessonDate},
        ${row.duplicateUserLookupId},
        ${row.duplicateFacets ? sql.json(row.duplicateFacets as unknown as postgres.JSONValue) : null},
        ${row.plannedAction}
      )
    `
  }
}

const listRows = async (batchId: string, executor: postgres.Sql = sql): Promise<DbImportBatchRow[]> => {
  return (await executor`
    SELECT * FROM public.import_batch_rows
    WHERE batch_id = ${batchId}
    ORDER BY row_index ASC
  `) as DbImportBatchRow[]
}

const setRowConfirmed = async (
  params: { rowId: string; confirmed: boolean },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    UPDATE public.import_batch_rows
    SET confirmed = ${params.confirmed}
    WHERE id = ${params.rowId}
  `
}

// Sweep expired DRAFTS only — confirmed batches are provenance and stay.
const deleteExpiredDrafts = async (): Promise<number> => {
  const result = await sql`
    DELETE FROM public.import_batches
    WHERE expires_at < NOW() AND status <> 'confirmed'
  `
  return result.count ?? 0
}

export interface ImportBatchesRepositoryInterface {
  insertBatch: (params: InsertBatchInput, executor?: postgres.Sql) => Promise<DbImportBatch | null>
  findByHashForUser: (params: {
    userId: string
    targetLanguage: string
    inputHash: string
  }) => Promise<DbImportBatch | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbImportBatch | null>
  findById: (id: string) => Promise<DbImportBatch | null>
  claimForConfirm: (
    params: { batchId: string; userId: string },
    executor?: postgres.Sql
  ) => Promise<DbImportBatch | null>
  markReady: (params: { batchId: string; formatProfile: string | null }, executor?: postgres.Sql) => Promise<void>
  markFailed: (params: { batchId: string; error: string }) => Promise<void>
  setStudySessionId: (params: { batchId: string; studySessionId: string }, executor?: postgres.Sql) => Promise<void>
  replaceRows: (params: { batchId: string; rows: InsertBatchRowInput[] }, executor?: postgres.Sql) => Promise<void>
  listRows: (batchId: string, executor?: postgres.Sql) => Promise<DbImportBatchRow[]>
  setRowConfirmed: (params: { rowId: string; confirmed: boolean }, executor?: postgres.Sql) => Promise<void>
  deleteExpiredDrafts: () => Promise<number>
}

export const ImportBatchesRepository = (): ImportBatchesRepositoryInterface => ({
  insertBatch,
  findByHashForUser,
  findByIdForUser,
  findById,
  claimForConfirm,
  markReady,
  markFailed,
  setStudySessionId,
  replaceRows,
  listRows,
  setRowConfirmed,
  deleteExpiredDrafts,
})
