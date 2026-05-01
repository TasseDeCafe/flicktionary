import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables, Database } from '../database.public.types'

export type DbStudySession = Tables<'study_sessions'>
export type StudySessionStatus = Database['public']['Enums']['study_session_status']

// Joined shape used by the list/get views: every UI surface that shows a session
// also wants the movie title and poster from content_sources.
export type DbStudySessionWithSource = DbStudySession & {
  content_source_title: string | null
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
  try {
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
  } catch (e) {
    logCustomErrorMessageAndError(`insertStudySession, userId = ${params.userId}`, e)
    return null
  }
}

const listByUserIdWithSource = async (userId: string): Promise<DbStudySessionWithSource[]> => {
  try {
    const result = (await sql`
      SELECT s.*,
             cs.title AS content_source_title,
             cs.metadata AS content_source_metadata
      FROM public.study_sessions s
      LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
      WHERE s.user_id = ${userId}
      ORDER BY s.created_at DESC
    `) as DbStudySessionWithSource[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.listByUserIdWithSource, userId = ${userId}`, e)
    return []
  }
}

const findByIdForUserWithSource = async (
  sessionId: string,
  userId: string
): Promise<DbStudySessionWithSource | null> => {
  try {
    const result = (await sql`
      SELECT s.*,
             cs.title AS content_source_title,
             cs.metadata AS content_source_metadata
      FROM public.study_sessions s
      LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
      WHERE s.id = ${sessionId} AND s.user_id = ${userId}
    `) as DbStudySessionWithSource[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.findByIdForUserWithSource, sessionId = ${sessionId}`, e)
    return null
  }
}

const findByIdForUser = async (sessionId: string, userId: string): Promise<DbStudySession | null> => {
  try {
    const result = (await sql`
      SELECT * FROM public.study_sessions
      WHERE id = ${sessionId} AND user_id = ${userId}
    `) as DbStudySession[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.findByIdForUser, sessionId = ${sessionId}`, e)
    return null
  }
}

const hasTextTrackForUser = async (textTrackId: string, userId: string): Promise<boolean> => {
  try {
    const result = await sql`
      SELECT 1
      FROM public.study_sessions
      WHERE text_track_id = ${textTrackId}
        AND user_id = ${userId}
      LIMIT 1
    `
    return result.length > 0
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.hasTextTrackForUser, textTrackId = ${textTrackId}`, e)
    return false
  }
}

const listByUserId = async (userId: string): Promise<DbStudySession[]> => {
  try {
    const result = (await sql`
      SELECT * FROM public.study_sessions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `) as DbStudySession[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.listByUserId, userId = ${userId}`, e)
    return []
  }
}

const updateStatus = async (sessionId: string, userId: string, status: StudySessionStatus): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.study_sessions
      SET status = ${status}
      WHERE id = ${sessionId} AND user_id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.updateStatus, sessionId = ${sessionId}`, e)
    return false
  }
}

const updateContextBlob = async (sessionId: string, userId: string, contextBlob: string): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.study_sessions
      SET context_blob = ${contextBlob}
      WHERE id = ${sessionId} AND user_id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.updateContextBlob, sessionId = ${sessionId}`, e)
    return false
  }
}

const appendProcessingWarning = async (sessionId: string, userId: string, warning: string): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.study_sessions
      SET processing_warnings = array_append(processing_warnings, ${warning})
      WHERE id = ${sessionId} AND user_id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.appendProcessingWarning, sessionId = ${sessionId}`, e)
    return false
  }
}

const markProcessed = async (sessionId: string, userId: string): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.study_sessions
      SET status = 'processed', processed_at = NOW()
      WHERE id = ${sessionId} AND user_id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.markProcessed, sessionId = ${sessionId}`, e)
    return false
  }
}

const markFailed = async (sessionId: string, userId: string): Promise<boolean> => {
  try {
    const result = await sql`
      UPDATE public.study_sessions
      SET status = 'failed'
      WHERE id = ${sessionId} AND user_id = ${userId}
    `
    return result.count === 1
  } catch (e) {
    logCustomErrorMessageAndError(`studySessions.markFailed, sessionId = ${sessionId}`, e)
    return false
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
  }
}
