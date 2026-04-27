import postgres from 'postgres'
import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables, Database } from '../database.public.types'

export type DbCard = Tables<'cards'>
export type CardStatus = Database['public']['Enums']['card_status']

export type CardFullExplorationJson = { readonly [key: string]: postgres.JSONValue | undefined }

export type CardInsertInput = {
  studySessionId: string
  highlightId: string | null
  segmentId: string
  headword: string
  surfaceForm: string
  fullExploration: CardFullExplorationJson
  status: CardStatus
}

const insertCard = async (params: CardInsertInput): Promise<DbCard | null> => {
  try {
    const result = (await sql`
      INSERT INTO public.cards (
        study_session_id, highlight_id, segment_id,
        headword, surface_form, full_exploration, status
      )
      VALUES (
        ${params.studySessionId},
        ${params.highlightId},
        ${params.segmentId},
        ${params.headword},
        ${params.surfaceForm},
        ${sql.json(params.fullExploration)},
        ${params.status}
      )
      RETURNING *
    `) as DbCard[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`insertCard, sessionId = ${params.studySessionId}`, e)
    return null
  }
}

const listBySessionId = async (studySessionId: string, status?: CardStatus): Promise<DbCard[]> => {
  try {
    const result = status
      ? ((await sql`
          SELECT * FROM public.cards
          WHERE study_session_id = ${studySessionId} AND status = ${status}
          ORDER BY created_at ASC
        `) as DbCard[])
      : ((await sql`
          SELECT * FROM public.cards
          WHERE study_session_id = ${studySessionId}
          ORDER BY created_at ASC
        `) as DbCard[])
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`cards.listBySessionId, studySessionId = ${studySessionId}`, e)
    return []
  }
}

const findById = async (id: string): Promise<DbCard | null> => {
  try {
    const result = (await sql`SELECT * FROM public.cards WHERE id = ${id}`) as DbCard[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`cards.findById, id = ${id}`, e)
    return null
  }
}

const findByIdForUser = async (id: string, userId: string): Promise<DbCard | null> => {
  try {
    const result = (await sql`
      SELECT c.* FROM public.cards c
      JOIN public.study_sessions s ON s.id = c.study_session_id
      WHERE c.id = ${id} AND s.user_id = ${userId}
    `) as DbCard[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`cards.findByIdForUser, id = ${id}`, e)
    return null
  }
}

const updateStatus = async (id: string, status: CardStatus): Promise<DbCard | null> => {
  try {
    const result = (await sql`
      UPDATE public.cards
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as DbCard[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`cards.updateStatus, id = ${id}`, e)
    return null
  }
}

const updateOverrides = async (
  id: string,
  frontOverride: string | null,
  backOverride: string | null
): Promise<DbCard | null> => {
  try {
    const result = (await sql`
      UPDATE public.cards
      SET front_override = ${frontOverride}, back_override = ${backOverride}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `) as DbCard[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`cards.updateOverrides, id = ${id}`, e)
    return null
  }
}

const listKeptForSession = async (studySessionId: string): Promise<DbCard[]> => {
  return listBySessionId(studySessionId, 'kept')
}

export interface CardsRepositoryInterface {
  insertCard: (params: CardInsertInput) => Promise<DbCard | null>
  listBySessionId: (studySessionId: string, status?: CardStatus) => Promise<DbCard[]>
  findById: (id: string) => Promise<DbCard | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbCard | null>
  updateStatus: (id: string, status: CardStatus) => Promise<DbCard | null>
  updateOverrides: (id: string, frontOverride: string | null, backOverride: string | null) => Promise<DbCard | null>
  listKeptForSession: (studySessionId: string) => Promise<DbCard[]>
}

export const CardsRepository = (): CardsRepositoryInterface => {
  return {
    insertCard,
    listBySessionId,
    findById,
    findByIdForUser,
    updateStatus,
    updateOverrides,
    listKeptForSession,
  }
}
