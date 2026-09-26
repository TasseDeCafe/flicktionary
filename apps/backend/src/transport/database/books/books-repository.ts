import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import type { DbContentSource } from '../content-sources/content-sources-repository'
import type { TrackModeration } from '../text-tracks/text-tracks-repository'
import { assertGuestSourceQuota } from '../guests/guest-source-quota'
import {
  insertStudySessionOn,
  type DbStudySession,
  type InsertStudySessionParams,
} from '../study-sessions/study-sessions-repository'

// A book is one content_source(type='book') whose metadata carries the upload
// state machine: 'uploading' (parts arriving, never readable) → 'ready'. Every
// upload attempt gets a fresh uploadId; part writes and finalize must present
// it, so a superseded attempt (another tab, a restarted upload) can't write
// into the current one.
export type BookImportStatus = 'uploading' | 'ready'

export type BookMetadata = {
  author: string | null
  fileName: string
  contentHash: string
  partCount: number
  importStatus: BookImportStatus
  uploadId: string | null
}

export const readBookMetadata = (source: DbContentSource): BookMetadata => {
  const metadata = (source.metadata ?? {}) as Record<string, unknown>
  return {
    author: typeof metadata.author === 'string' ? metadata.author : null,
    fileName: typeof metadata.fileName === 'string' ? metadata.fileName : '',
    contentHash: typeof metadata.contentHash === 'string' ? metadata.contentHash : '',
    partCount: typeof metadata.partCount === 'number' ? metadata.partCount : 0,
    importStatus: metadata.importStatus === 'ready' ? 'ready' : 'uploading',
    uploadId: typeof metadata.uploadId === 'string' ? metadata.uploadId : null,
  }
}

export const isBookReady = (source: DbContentSource): boolean => readBookMetadata(source).importStatus === 'ready'

export type BookPartInsert = {
  partIndex: number
  title: string
  hash: string
  segments: string[]
}

export type DbBookPart = {
  text_track_id: string
  book_part_index: number
  book_part_title: string
  segment_count: number
  session_id: string | null
  furthest_read_segment_index: number | null
  last_read_at: Date | string | null
}

export type StartUploadResult =
  { kind: 'ready'; source: DbContentSource } | { kind: 'uploading'; source: DbContentSource; uploadId: string }

const lockUserBookUploads = async (userId: string, tx: postgres.Sql): Promise<void> => {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`book-upload:${userId}`}))`
}

const lockOwnedBook = async (
  contentSourceId: string,
  userId: string,
  tx: postgres.Sql
): Promise<DbContentSource | null> => {
  const rows = (await tx`
    SELECT * FROM public.content_sources
    WHERE id = ${contentSourceId} AND created_by_user_id = ${userId} AND type = 'book'
    FOR UPDATE
  `) as DbContentSource[]
  return rows[0] ?? null
}

// Starts an upload attempt (or resolves a dedup hit on a ready book). A user
// has at most ONE book uploading at a time: starting any upload deletes their
// other unfinished uploads, which bounds abandoned multi-megabyte uploads
// without a cleanup job. Re-starting the same book deletes its received parts
// and rotates the uploadId.
const startUpload = async (params: {
  userId: string
  title: string
  language: string
  author: string | null
  fileName: string
  contentHash: string
  partCount: number
}): Promise<StartUploadResult> => {
  return await beginTx(async (tx) => {
    await lockUserBookUploads(params.userId, tx)
    const existingRows = (await tx`
      SELECT * FROM public.content_sources
      WHERE type = 'book'
        AND created_by_user_id = ${params.userId}
        AND metadata->>'contentHash' = ${params.contentHash}
      FOR UPDATE
    `) as DbContentSource[]
    const existing = existingRows[0] ?? null
    if (existing && isBookReady(existing)) return { kind: 'ready', source: existing }

    await tx`
      DELETE FROM public.content_sources
      WHERE type = 'book'
        AND created_by_user_id = ${params.userId}
        AND metadata->>'importStatus' = 'uploading'
        AND id IS DISTINCT FROM ${existing?.id ?? null}::uuid
    `

    const uploadId = randomUUID()
    const metadata: BookMetadata = {
      author: params.author,
      fileName: params.fileName,
      contentHash: params.contentHash,
      partCount: params.partCount,
      importStatus: 'uploading',
      uploadId,
    }

    if (existing) {
      await tx`DELETE FROM public.text_tracks WHERE content_source_id = ${existing.id}`
      const updated = (await tx`
        UPDATE public.content_sources
        SET title = ${params.title}, language = ${params.language}, metadata = ${tx.json(metadata)}
        WHERE id = ${existing.id}
        RETURNING *
      `) as DbContentSource[]
      return { kind: 'uploading', source: updated[0]!, uploadId }
    }

    await assertGuestSourceQuota(params.userId, tx)
    const inserted = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('book', ${params.title}, ${params.language}, ${tx.json(metadata)}, ${params.userId})
      RETURNING *
    `) as DbContentSource[]
    return { kind: 'uploading', source: inserted[0]!, uploadId }
  })
}

export type AppendPartsResult =
  { ok: true; receivedPartCount: number } | { ok: false; reason: 'not-found' | 'stale-upload' | 'part-out-of-range' }

// Writes parts under the source row lock after verifying the upload attempt.
// Idempotent per part index: a part that already arrived is skipped.
const appendParts = async (params: {
  contentSourceId: string
  userId: string
  uploadId: string
  parts: BookPartInsert[]
}): Promise<AppendPartsResult> => {
  return await beginTx(async (tx) => {
    const source = await lockOwnedBook(params.contentSourceId, params.userId, tx)
    if (!source) return { ok: false, reason: 'not-found' }
    const metadata = readBookMetadata(source)
    if (metadata.importStatus !== 'uploading' || metadata.uploadId !== params.uploadId) {
      return { ok: false, reason: 'stale-upload' }
    }
    if (params.parts.some((part) => part.partIndex >= metadata.partCount)) {
      return { ok: false, reason: 'part-out-of-range' }
    }

    for (const part of params.parts) {
      const inserted = (await tx`
        INSERT INTO public.text_tracks (
          content_source_id, source, language, external_id, hash, book_part_index, book_part_title
        )
        VALUES (
          ${source.id}, 'upload', ${source.language}, NULL, ${part.hash}, ${part.partIndex}, ${part.title}
        )
        ON CONFLICT (content_source_id, book_part_index) WHERE book_part_index IS NOT NULL
          DO NOTHING
        RETURNING id
      `) as { id: string }[]
      const trackId = inserted[0]?.id
      if (!trackId) continue
      const rows = part.segments.map((text, index) => ({
        text_track_id: trackId,
        index,
        text,
        start_ms: null,
        end_ms: null,
      }))
      await tx`
        INSERT INTO public.text_segments ${tx(rows, 'text_track_id', 'index', 'text', 'start_ms', 'end_ms')}
      `
    }

    const counted = (await tx`
      SELECT count(*)::int AS count FROM public.text_tracks WHERE content_source_id = ${source.id}
    `) as { count: number }[]
    return { ok: true, receivedPartCount: counted[0]?.count ?? 0 }
  })
}

// Full text per part, in reading order — the input of the moderation sample.
const listPartTexts = async (contentSourceId: string): Promise<{ partIndex: number; text: string }[]> => {
  const rows = (await sql`
    SELECT t.book_part_index AS part_index,
           string_agg(s.text, E'\n' ORDER BY s.index) AS text
    FROM public.text_tracks t
    JOIN public.text_segments s ON s.text_track_id = t.id
    WHERE t.content_source_id = ${contentSourceId}
    GROUP BY t.book_part_index
    ORDER BY t.book_part_index
  `) as { part_index: number; text: string }[]
  return rows.map((row) => ({ partIndex: row.part_index, text: row.text }))
}

export type FinalizeUploadResult =
  { ok: true; session: DbStudySession } | { ok: false; reason: 'not-found' | 'stale-upload' | 'incomplete' }

// The commit point of an upload: stamps the moderation verdict on every part,
// creates the first part's session (guest quota checked in the same
// transaction) and flips the book to ready — all or nothing, so a failure
// leaves a retryable upload, never a ready book without a session.
const finalizeUpload = async (params: {
  contentSourceId: string
  userId: string
  uploadId: string
  moderation: TrackModeration | null
  session: Omit<InsertStudySessionParams, 'contentSourceId' | 'textTrackId' | 'userId'>
}): Promise<FinalizeUploadResult> => {
  return await beginTx(async (tx) => {
    const source = await lockOwnedBook(params.contentSourceId, params.userId, tx)
    if (!source) return { ok: false, reason: 'not-found' }
    const metadata = readBookMetadata(source)
    if (metadata.importStatus !== 'uploading' || metadata.uploadId !== params.uploadId) {
      return { ok: false, reason: 'stale-upload' }
    }
    const tracks = (await tx`
      SELECT id, book_part_index FROM public.text_tracks
      WHERE content_source_id = ${source.id}
      ORDER BY book_part_index
    `) as { id: string; book_part_index: number }[]
    if (tracks.length !== metadata.partCount) return { ok: false, reason: 'incomplete' }

    if (params.moderation) {
      await tx`
        UPDATE public.text_tracks
        SET moderation_status = ${params.moderation.status}, moderation_category = ${params.moderation.category}
        WHERE content_source_id = ${source.id}
      `
    }
    const inserted = await insertStudySessionOn(tx, {
      ...params.session,
      userId: params.userId,
      contentSourceId: source.id,
      textTrackId: tracks[0]!.id,
    })
    if (!inserted) return { ok: false, reason: 'not-found' }
    const readyMetadata: BookMetadata = { ...metadata, importStatus: 'ready', uploadId: null }
    await tx`
      UPDATE public.content_sources SET metadata = ${tx.json(readyMetadata)} WHERE id = ${source.id}
    `
    return { ok: true, session: inserted.session }
  })
}

// A blocked upload is removed entirely (tracks + segments cascade); it never
// had sessions, since sessions are refused until the book is ready.
const deleteUploadingBook = async (contentSourceId: string, userId: string): Promise<void> => {
  await sql`
    DELETE FROM public.content_sources
    WHERE id = ${contentSourceId}
      AND created_by_user_id = ${userId}
      AND type = 'book'
      AND metadata->>'importStatus' = 'uploading'
  `
}

const findOwnedBook = async (contentSourceId: string, userId: string): Promise<DbContentSource | null> => {
  const rows = (await sql`
    SELECT * FROM public.content_sources
    WHERE id = ${contentSourceId} AND created_by_user_id = ${userId} AND type = 'book'
  `) as DbContentSource[]
  return rows[0] ?? null
}

// Parts in reading order with the user's live session on each (if opened).
// segment_count reads the (text_track_id, index) unique index only.
const listPartsForUser = async (contentSourceId: string, userId: string): Promise<DbBookPart[]> => {
  return (await sql`
    SELECT t.id AS text_track_id,
           t.book_part_index,
           t.book_part_title,
           (SELECT count(*)::int FROM public.text_segments seg WHERE seg.text_track_id = t.id) AS segment_count,
           s.id AS session_id,
           s.furthest_read_segment_index,
           s.last_read_at
    FROM public.text_tracks t
    LEFT JOIN public.study_sessions s
      ON s.text_track_id = t.id AND s.user_id = ${userId} AND s.deleted_at IS NULL
    WHERE t.content_source_id = ${contentSourceId}
    ORDER BY t.book_part_index
  `) as DbBookPart[]
}

// Soft-deletes every part session AND unpins the book in one transaction: the
// source row survives removal for dedup, so a re-upload must not come back
// pinned.
const removeForUser = async (contentSourceId: string, userId: string): Promise<void> => {
  await beginTx(async (tx) => {
    await tx`
      UPDATE public.study_sessions
      SET deleted_at = NOW()
      WHERE content_source_id = ${contentSourceId} AND user_id = ${userId} AND deleted_at IS NULL
    `
    await tx`DELETE FROM public.book_pins WHERE content_source_id = ${contentSourceId} AND user_id = ${userId}`
  })
}

export type DbBookPartAnalysis = {
  text_track_id: string
  profile_built_at: string | null
  profile_version: number | null
  latest_job_status: 'pending' | 'processing' | 'done' | 'failed' | null
}

// Per-part lemma-profile state for the pinned-book analysis status: the
// profile bookkeeping plus the latest build job's status, in one read.
const listPartAnalysis = async (contentSourceId: string): Promise<DbBookPartAnalysis[]> => {
  return (await sql`
    SELECT t.id AS text_track_id, t.profile_built_at, t.profile_version,
      (
        SELECT j.status FROM public.processing_jobs j
        WHERE j.text_track_id = t.id AND j.kind = 'build_track_lemma_profile'
        ORDER BY j.created_at DESC
        LIMIT 1
      ) AS latest_job_status
    FROM public.text_tracks t
    WHERE t.content_source_id = ${contentSourceId}
    ORDER BY t.book_part_index
  `) as DbBookPartAnalysis[]
}

export interface BooksRepositoryInterface {
  startUpload: typeof startUpload
  appendParts: typeof appendParts
  listPartTexts: typeof listPartTexts
  finalizeUpload: typeof finalizeUpload
  deleteUploadingBook: typeof deleteUploadingBook
  findOwnedBook: typeof findOwnedBook
  listPartsForUser: typeof listPartsForUser
  removeForUser: typeof removeForUser
  listPartAnalysis: typeof listPartAnalysis
}

export const BooksRepository = (): BooksRepositoryInterface => ({
  startUpload,
  appendParts,
  listPartTexts,
  finalizeUpload,
  deleteUploadingBook,
  findOwnedBook,
  listPartsForUser,
  removeForUser,
  listPartAnalysis,
})
