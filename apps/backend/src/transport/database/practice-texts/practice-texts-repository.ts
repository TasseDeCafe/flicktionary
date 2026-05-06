import postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbPracticeText = Tables<'practice_texts'>
export type PracticeTextStatus = Database['public']['Enums']['practice_text_status']

export type PracticeAnnotation = {
  headword: string
  sense: string
  surfaceForm: string
  charStart: number
  charEnd: number
}

const insertPending = async (params: { practiceSessionId: string; ord: number }): Promise<DbPracticeText> => {
  const result = (await sql`
    INSERT INTO public.practice_texts (practice_session_id, ord, status)
    VALUES (${params.practiceSessionId}, ${params.ord}, 'pending')
    RETURNING *
  `) as DbPracticeText[]
  return result[0]!
}

const markGenerating = async (id: string): Promise<void> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'generating'
    WHERE id = ${id} AND status IN ('pending')
  `
}

const markReady = async (params: {
  id: string
  body: string
  annotations: PracticeAnnotation[]
  generationWarning: string | null
}): Promise<DbPracticeText | null> => {
  const annotationsJson = sql.json(
    params.annotations.map((a) => ({
      headword: a.headword,
      sense: a.sense,
      surface_form: a.surfaceForm,
      char_start: a.charStart,
      char_end: a.charEnd,
    })) as unknown as postgres.JSONValue
  )
  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'ready',
        body = ${params.body},
        annotations = ${annotationsJson}::jsonb,
        generation_warning = ${params.generationWarning},
        ready_at = NOW()
    WHERE id = ${params.id}
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

const markFailed = async (params: { id: string; warning: string }): Promise<void> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'failed', generation_warning = ${params.warning}
    WHERE id = ${params.id}
  `
}

const markReading = async (id: string): Promise<void> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'reading'
    WHERE id = ${id} AND status = 'ready'
  `
}

const markDone = async (id: string): Promise<void> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'done', read_at = NOW()
    WHERE id = ${id} AND status IN ('ready', 'reading')
  `
}

const findById = async (id: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    SELECT * FROM public.practice_texts WHERE id = ${id}
  `) as DbPracticeText[]
  return result[0] ?? null
}

// Ownership-checked fetch: joins through practice_sessions to verify user_id.
const findByIdForUser = async (
  id: string,
  userId: string
): Promise<{ practiceText: DbPracticeText; practiceSessionId: string; targetLanguage: string } | null> => {
  const result = (await sql`
    SELECT pt.*, ps.target_language AS session_target_language, ps.user_id AS session_user_id
    FROM public.practice_texts pt
    JOIN public.practice_sessions ps ON ps.id = pt.practice_session_id
    WHERE pt.id = ${id} AND ps.user_id = ${userId}
  `) as Array<DbPracticeText & { session_target_language: string; session_user_id: string }>
  const row = result[0]
  if (!row) return null
  const { session_target_language, session_user_id, ...practiceText } = row as DbPracticeText & {
    session_target_language: string
    session_user_id: string
  }
  void session_user_id
  return {
    practiceText: practiceText as DbPracticeText,
    practiceSessionId: practiceText.practice_session_id,
    targetLanguage: session_target_language,
  }
}

const listBySessionId = async (practiceSessionId: string): Promise<DbPracticeText[]> => {
  return (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE practice_session_id = ${practiceSessionId}
    ORDER BY ord ASC
  `) as DbPracticeText[]
}

// Returns the most recently created text in a state the user is meant to act
// on: 'ready' or 'reading'. Used to resume a session.
const findCurrentReadable = async (practiceSessionId: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE practice_session_id = ${practiceSessionId}
      AND status IN ('ready', 'reading')
    ORDER BY ord DESC
    LIMIT 1
  `) as DbPracticeText[]
  return result[0] ?? null
}

const getNextOrd = async (practiceSessionId: string): Promise<number> => {
  const result = await sql`
    SELECT COALESCE(MAX(ord), -1) + 1 AS next_ord
    FROM public.practice_texts
    WHERE practice_session_id = ${practiceSessionId}
  `
  return (result[0]?.next_ord as number) ?? 0
}

// Returns the union of (headword, sense) pairs already covered by any
// completed-or-current practice_text in this session. The caller subtracts
// these from the "due" set to avoid surfacing the same chunk twice in one
// sitting.
const getCoveredHeadwordSenses = async (
  practiceSessionId: string
): Promise<Array<{ headword: string; sense: string }>> => {
  const result = await sql`
    SELECT DISTINCT
      ann->>'headword' AS headword,
      COALESCE(ann->>'sense', '') AS sense
    FROM public.practice_texts pt,
         jsonb_array_elements(pt.annotations) AS ann
    WHERE pt.practice_session_id = ${practiceSessionId}
      AND pt.status IN ('ready', 'reading', 'done')
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
  }))
}

export interface PracticeTextsRepositoryInterface {
  insertPending: (params: { practiceSessionId: string; ord: number }) => Promise<DbPracticeText>
  markGenerating: (id: string) => Promise<void>
  markReady: (params: {
    id: string
    body: string
    annotations: PracticeAnnotation[]
    generationWarning: string | null
  }) => Promise<DbPracticeText | null>
  markFailed: (params: { id: string; warning: string }) => Promise<void>
  markReading: (id: string) => Promise<void>
  markDone: (id: string) => Promise<void>
  findById: (id: string) => Promise<DbPracticeText | null>
  findByIdForUser: (
    id: string,
    userId: string
  ) => Promise<{ practiceText: DbPracticeText; practiceSessionId: string; targetLanguage: string } | null>
  listBySessionId: (practiceSessionId: string) => Promise<DbPracticeText[]>
  findCurrentReadable: (practiceSessionId: string) => Promise<DbPracticeText | null>
  getNextOrd: (practiceSessionId: string) => Promise<number>
  getCoveredHeadwordSenses: (practiceSessionId: string) => Promise<Array<{ headword: string; sense: string }>>
}

export const PracticeTextsRepository = (): PracticeTextsRepositoryInterface => {
  return {
    insertPending,
    markGenerating,
    markReady,
    markFailed,
    markReading,
    markDone,
    findById,
    findByIdForUser,
    listBySessionId,
    findCurrentReadable,
    getNextOrd,
    getCoveredHeadwordSenses,
  }
}
