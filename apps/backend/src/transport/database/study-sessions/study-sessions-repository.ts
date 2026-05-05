import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbStudySession = Tables<'study_sessions'>
export type StudySessionStatus = Database['public']['Enums']['study_session_status']

// Joined shape used by the list/get views: every UI surface that shows a session
// also wants the movie title and poster from content_sources.
export type ContentSourceType = Database['public']['Enums']['content_source_type']

export type DbStudySessionWithSource = DbStudySession & {
  content_source_title: string | null
  content_source_type: ContentSourceType | null
  content_source_metadata: Record<string, unknown> | null
}

const insertStudySession = async (params: {
  userId: string
  contentSourceId: string
  textTrackId: string
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
}): Promise<DbStudySession | null> => {
  const result = (await sql`
    INSERT INTO public.study_sessions (
      user_id, content_source_id, text_track_id,
      native_language, target_language, cefr_level
    )
    SELECT
      ${params.userId},
      ${params.contentSourceId},
      ${params.textTrackId},
      ${params.nativeLanguage},
      ${params.targetLanguage},
      ${params.cefrLevel}
    WHERE EXISTS (
      SELECT 1
      FROM public.text_tracks
      WHERE id = ${params.textTrackId}
        AND content_source_id = ${params.contentSourceId}
    )
    RETURNING *
  `) as DbStudySession[]
  return result[0] ?? null
}

// Soft-deleted sessions are filtered out everywhere except softDelete itself
// and the highlight/card chains, which keep working so kept vocabulary can
// still back-link to its source. Hard erasure happens via account deletion
// (auth.users CASCADE).
const listByUserIdWithSource = async (userId: string): Promise<DbStudySessionWithSource[]> => {
  return (await sql`
    SELECT s.*,
           cs.title AS content_source_title,
           cs.type AS content_source_type,
           cs.metadata AS content_source_metadata
    FROM public.study_sessions s
    LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
    WHERE s.user_id = ${userId} AND s.deleted_at IS NULL
    ORDER BY s.created_at DESC
  `) as DbStudySessionWithSource[]
}

const findByIdForUserWithSource = async (
  sessionId: string,
  userId: string
): Promise<DbStudySessionWithSource | null> => {
  const result = (await sql`
    SELECT s.*,
           cs.title AS content_source_title,
           cs.type AS content_source_type,
           cs.metadata AS content_source_metadata
    FROM public.study_sessions s
    LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
    WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.deleted_at IS NULL
  `) as DbStudySessionWithSource[]
  return result[0] ?? null
}

const findByIdForUser = async (sessionId: string, userId: string): Promise<DbStudySession | null> => {
  const result = (await sql`
    SELECT * FROM public.study_sessions
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `) as DbStudySession[]
  return result[0] ?? null
}

const hasTextTrackForUser = async (textTrackId: string, userId: string): Promise<boolean> => {
  const result = await sql`
    SELECT 1
    FROM public.study_sessions
    WHERE text_track_id = ${textTrackId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `
  return result.length > 0
}

const listByUserId = async (userId: string): Promise<DbStudySession[]> => {
  return (await sql`
    SELECT * FROM public.study_sessions
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `) as DbStudySession[]
}

const updateStatus = async (sessionId: string, userId: string, status: StudySessionStatus): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET status = ${status}
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const updateContextBlob = async (sessionId: string, userId: string, contextBlob: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET context_blob = ${contextBlob}
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const appendProcessingWarning = async (sessionId: string, userId: string, warning: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET processing_warnings = array_append(processing_warnings, ${warning})
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const markProcessed = async (sessionId: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET status = 'processed', processed_at = NOW()
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const markFailed = async (sessionId: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET status = 'failed'
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const softDelete = async (sessionId: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET deleted_at = NOW()
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

export type DeletePreview = {
  status: StudySessionStatus
  highlightCount: number
  cardCount: number
  keptCardCount: number
}

const getDeletePreview = async (sessionId: string, userId: string): Promise<DeletePreview | null> => {
  const result = (await sql`
    SELECT
      s.status,
      (SELECT COUNT(*)::int FROM public.highlights h WHERE h.study_session_id = s.id) AS highlight_count,
      (SELECT COUNT(*)::int FROM public.cards c WHERE c.study_session_id = s.id) AS card_count,
      (SELECT COUNT(*)::int FROM public.cards c WHERE c.study_session_id = s.id AND c.status = 'kept') AS kept_card_count
    FROM public.study_sessions s
    WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.deleted_at IS NULL
  `) as Array<{
    status: StudySessionStatus
    highlight_count: number
    card_count: number
    kept_card_count: number
  }>
  const row = result[0]
  if (!row) return null
  return {
    status: row.status,
    highlightCount: row.highlight_count,
    cardCount: row.card_count,
    keptCardCount: row.kept_card_count,
  }
}

export interface StudySessionsRepositoryInterface {
  insertStudySession: (params: {
    userId: string
    contentSourceId: string
    textTrackId: string
    nativeLanguage: string
    targetLanguage: string
    cefrLevel: string
  }) => Promise<DbStudySession | null>
  findByIdForUser: (sessionId: string, userId: string) => Promise<DbStudySession | null>
  findByIdForUserWithSource: (sessionId: string, userId: string) => Promise<DbStudySessionWithSource | null>
  hasTextTrackForUser: (textTrackId: string, userId: string) => Promise<boolean>
  listByUserId: (userId: string) => Promise<DbStudySession[]>
  listByUserIdWithSource: (userId: string) => Promise<DbStudySessionWithSource[]>
  updateStatus: (sessionId: string, userId: string, status: StudySessionStatus) => Promise<boolean>
  updateContextBlob: (sessionId: string, userId: string, contextBlob: string) => Promise<boolean>
  appendProcessingWarning: (sessionId: string, userId: string, warning: string) => Promise<boolean>
  markProcessed: (sessionId: string, userId: string) => Promise<boolean>
  markFailed: (sessionId: string, userId: string) => Promise<boolean>
  softDelete: (sessionId: string, userId: string) => Promise<boolean>
  getDeletePreview: (sessionId: string, userId: string) => Promise<DeletePreview | null>
}

export const StudySessionsRepository = (): StudySessionsRepositoryInterface => {
  return {
    insertStudySession,
    findByIdForUser,
    findByIdForUserWithSource,
    hasTextTrackForUser,
    listByUserId,
    listByUserIdWithSource,
    updateStatus,
    updateContextBlob,
    appendProcessingWarning,
    markProcessed,
    markFailed,
    softDelete,
    getDeletePreview,
  }
}
