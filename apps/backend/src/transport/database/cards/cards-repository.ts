import postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbCard = Tables<'cards'>
export type CardStatus = Database['public']['Enums']['card_status']

export type ExplorationExtras = { readonly [key: string]: postgres.JSONValue | undefined }

export type CardInsertInput = {
  studySessionId: string
  highlightId: string | null
  segmentId: string
  headword: string
  sense: string
  surfaceForm: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  explorationExtras: ExplorationExtras
  status: CardStatus
}

const insertCard = async (params: CardInsertInput): Promise<DbCard> => {
  const result = (await sql`
    INSERT INTO public.cards (
      study_session_id, highlight_id, segment_id,
      headword, sense, surface_form,
      translation, definition, target_example, native_example,
      exploration_extras, status
    )
    VALUES (
      ${params.studySessionId},
      ${params.highlightId},
      ${params.segmentId},
      ${params.headword},
      ${params.sense},
      ${params.surfaceForm},
      ${params.translation},
      ${params.definition},
      ${params.targetExample},
      ${params.nativeExample},
      ${sql.json(params.explorationExtras)},
      ${params.status}
    )
    RETURNING *
  `) as DbCard[]
  return result[0]!
}

const listBySessionId = async (studySessionId: string, status?: CardStatus): Promise<DbCard[]> => {
  return status
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
}

const findById = async (id: string): Promise<DbCard | null> => {
  const result = (await sql`SELECT * FROM public.cards WHERE id = ${id}`) as DbCard[]
  return result[0] ?? null
}

const findByIdForUser = async (id: string, userId: string): Promise<DbCard | null> => {
  const result = (await sql`
    SELECT c.* FROM public.cards c
    JOIN public.study_sessions s ON s.id = c.study_session_id
    WHERE c.id = ${id} AND s.user_id = ${userId}
  `) as DbCard[]
  return result[0] ?? null
}

const updateStatus = async (id: string, status: CardStatus): Promise<DbCard | null> => {
  const result = (await sql`
    UPDATE public.cards
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as DbCard[]
  return result[0] ?? null
}

const updateStatusBatch = async (
  studySessionId: string,
  cardIds: string[],
  status: CardStatus
): Promise<DbCard[]> => {
  if (cardIds.length === 0) return []
  const result = (await sql`
    UPDATE public.cards
    SET status = ${status}, updated_at = NOW()
    WHERE study_session_id = ${studySessionId} AND id = ANY(${cardIds}::uuid[])
    RETURNING *
  `) as DbCard[]
  return result
}

// Patch shape for partial updates. `null` on a field means "leave the column
// unchanged" (handled via COALESCE on the SQL side). To clear a basic field,
// pass an explicit empty string. `extrasPatch` is shallow-merged into
// exploration_extras via `||` jsonb concat.
export type CardFieldsPatch = {
  headword?: string | null
  sense?: string | null
  surfaceForm?: string | null
  translation?: string | null
  definition?: string | null
  targetExample?: string | null
  nativeExample?: string | null
  extrasPatch?: Record<string, unknown> | null
}

const updateFields = async (id: string, patch: CardFieldsPatch): Promise<DbCard | null> => {
  const extras = patch.extrasPatch ?? null
  const extrasJson = extras ? sql.json(extras as unknown as postgres.JSONValue) : null
  const result = (await sql`
    UPDATE public.cards
    SET
      headword       = COALESCE(${patch.headword ?? null}, headword),
      sense          = COALESCE(${patch.sense ?? null}, sense),
      surface_form   = COALESCE(${patch.surfaceForm ?? null}, surface_form),
      translation    = COALESCE(${patch.translation ?? null}, translation),
      definition     = COALESCE(${patch.definition ?? null}, definition),
      target_example = COALESCE(${patch.targetExample ?? null}, target_example),
      native_example = COALESCE(${patch.nativeExample ?? null}, native_example),
      exploration_extras = exploration_extras || COALESCE(${extrasJson}::jsonb, '{}'::jsonb),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as DbCard[]
  return result[0] ?? null
}

const listKeptForSession = async (studySessionId: string): Promise<DbCard[]> => {
  return listBySessionId(studySessionId, 'kept')
}

export interface CardsRepositoryInterface {
  insertCard: (params: CardInsertInput) => Promise<DbCard>
  listBySessionId: (studySessionId: string, status?: CardStatus) => Promise<DbCard[]>
  findById: (id: string) => Promise<DbCard | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbCard | null>
  updateStatus: (id: string, status: CardStatus) => Promise<DbCard | null>
  updateStatusBatch: (studySessionId: string, cardIds: string[], status: CardStatus) => Promise<DbCard[]>
  updateFields: (id: string, patch: CardFieldsPatch) => Promise<DbCard | null>
  listKeptForSession: (studySessionId: string) => Promise<DbCard[]>
}

export const CardsRepository = (): CardsRepositoryInterface => {
  return {
    insertCard,
    listBySessionId,
    findById,
    findByIdForUser,
    updateStatus,
    updateStatusBatch,
    updateFields,
    listKeptForSession,
  }
}
