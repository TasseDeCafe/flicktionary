import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbCard = Tables<'cards'>
export type CardStatus = Database['public']['Enums']['card_status']

// The chunk view returned alongside each card on read paths. After the
// content refactor, headword/sense and the gloss fields live on user_lookups,
// so anything that wants to display a card must JOIN to user_lookups. We
// expose a typed `chunk` shape so callers don't have to re-derive it.
export type DbChunkSummary = {
  id: string
  user_id: string
  target_language: string
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  target_example: string | null
  native_example: string | null
  exploration_extras: Record<string, unknown>
  grammar: Record<string, unknown>
  grounded_at: string | null
  grammar_user_edited_at: string | null
  learning_mode: 'passive' | 'active'
}

export type DbCardWithChunk = DbCard & { chunk: DbChunkSummary; has_unread_chat: boolean }

export type CardInsertInput = {
  studySessionId: string
  highlightId: string | null
  segmentId: string
  userLookupId: string
  surfaceForm: string
  status: CardStatus
}

const insertCard = async (params: CardInsertInput): Promise<DbCard> => {
  const result = (await sql`
    INSERT INTO public.cards (
      study_session_id, highlight_id, segment_id, user_lookup_id, surface_form, status
    )
    VALUES (
      ${params.studySessionId},
      ${params.highlightId},
      ${params.segmentId},
      ${params.userLookupId},
      ${params.surfaceForm},
      ${params.status}
    )
    RETURNING *
  `) as DbCard[]
  return result[0]!
}

// Idempotent insert for highlight-backed cards: guarded by the partial unique
// index cards_highlight_id_unique. The background enrichment worker retries on
// transient failure, so a single highlight must never produce two cards. On
// conflict the INSERT does nothing and RETURNING is empty, so we read back the
// pre-existing row. Callers must pass a non-null highlightId.
const insertCardForHighlightIdempotent = async (params: CardInsertInput & { highlightId: string }): Promise<DbCard> => {
  const inserted = (await sql`
    INSERT INTO public.cards (
      study_session_id, highlight_id, segment_id, user_lookup_id, surface_form, status
    )
    VALUES (
      ${params.studySessionId},
      ${params.highlightId},
      ${params.segmentId},
      ${params.userLookupId},
      ${params.surfaceForm},
      ${params.status}
    )
    ON CONFLICT (highlight_id) WHERE highlight_id IS NOT NULL
    DO NOTHING
    RETURNING *
  `) as DbCard[]
  if (inserted[0]) return inserted[0]
  const existing = (await sql`
    SELECT * FROM public.cards WHERE highlight_id = ${params.highlightId}
  `) as DbCard[]
  return existing[0]!
}

const SELECT_CARD_WITH_CHUNK_SQL = sql`
  SELECT
    c.*,
    jsonb_build_object(
      'id', ul.id,
      'user_id', ul.user_id,
      'target_language', ul.target_language,
      'headword', ul.headword,
      'sense', ul.sense,
      'translation', ul.translation,
      'definition', ul.definition,
      'target_example', ul.target_example,
      'native_example', ul.native_example,
      'exploration_extras', ul.exploration_extras,
      'grammar', ul.grammar,
      'grounded_at', ul.grounded_at,
      'grammar_user_edited_at', ul.grammar_user_edited_at,
      'learning_mode',
        CASE WHEN pf.disabled_at IS NULL AND pf.id IS NOT NULL THEN 'active' ELSE 'passive' END
    ) AS chunk,
    -- Unread iff the newest assistant turn is newer than the user's last read.
    -- role = 'assistant' is required: otherwise sending a user message bumps
    -- MAX(created_at) and re-lights the dot for content the user just wrote.
    -- Both subqueries are index-backed (idx_card_chat_messages_card_id_created
    -- + the card_chat_read_state PK).
    COALESCE(
      (SELECT MAX(m.created_at) FROM public.card_chat_messages m
       WHERE m.card_id = c.id AND m.role = 'assistant'),
      'epoch'::timestamptz
    ) > COALESCE(
      (SELECT r.last_read_at FROM public.card_chat_read_state r WHERE r.card_id = c.id),
      'epoch'::timestamptz
    ) AS has_unread_chat
  FROM public.cards c
  JOIN public.user_lookups ul ON ul.id = c.user_lookup_id
  LEFT JOIN public.study_facets pf
    ON pf.user_lookup_id = ul.id AND pf.skill = 'meaning_production' AND pf.target_form = ''
`

const listBySessionId = async (studySessionId: string, status?: CardStatus): Promise<DbCardWithChunk[]> => {
  const rows = status
    ? ((await sql`
        ${SELECT_CARD_WITH_CHUNK_SQL}
        WHERE c.study_session_id = ${studySessionId} AND c.status = ${status}
        ORDER BY c.created_at ASC
      `) as DbCardWithChunk[])
    : ((await sql`
        ${SELECT_CARD_WITH_CHUNK_SQL}
        WHERE c.study_session_id = ${studySessionId}
        ORDER BY c.created_at ASC
      `) as DbCardWithChunk[])
  return rows
}

const findById = async (id: string): Promise<DbCardWithChunk | null> => {
  const result = (await sql`
    ${SELECT_CARD_WITH_CHUNK_SQL}
    WHERE c.id = ${id}
  `) as DbCardWithChunk[]
  return result[0] ?? null
}

const findByIdForUser = async (id: string, userId: string): Promise<DbCardWithChunk | null> => {
  const result = (await sql`
    ${SELECT_CARD_WITH_CHUNK_SQL}
    JOIN public.study_sessions s ON s.id = c.study_session_id
    WHERE c.id = ${id} AND s.user_id = ${userId}
  `) as DbCardWithChunk[]
  return result[0] ?? null
}

// Resolve the (unique) card materialized for a highlight. Used by the
// seed_card_chat worker to find the card enrichment created for a just-saved
// note. cards.highlight_id is uniquely indexed, so at most one row matches.
const findByHighlightId = async (highlightId: string): Promise<DbCardWithChunk | null> => {
  const result = (await sql`
    ${SELECT_CARD_WITH_CHUNK_SQL}
    WHERE c.highlight_id = ${highlightId}
  `) as DbCardWithChunk[]
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

const updateStatusBatch = async (studySessionId: string, cardIds: string[], status: CardStatus): Promise<DbCard[]> => {
  if (cardIds.length === 0) return []
  const result = (await sql`
    UPDATE public.cards
    SET status = ${status}, updated_at = NOW()
    WHERE study_session_id = ${studySessionId} AND id = ANY(${cardIds}::uuid[])
    RETURNING *
  `) as DbCard[]
  return result
}

// Card-level field patch. Vocabulary content (headword/sense/translation/etc.)
// lives on user_lookups now and is patched via userLookupsRepository.
export type CardFieldsPatch = {
  surfaceForm?: string | null
}

const updateFields = async (id: string, patch: CardFieldsPatch): Promise<DbCard | null> => {
  const result = (await sql`
    UPDATE public.cards
    SET
      surface_form = COALESCE(${patch.surfaceForm ?? null}, surface_form),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as DbCard[]
  return result[0] ?? null
}

const listKeptForSession = async (studySessionId: string): Promise<DbCardWithChunk[]> => {
  return listBySessionId(studySessionId, 'kept')
}

export interface CardsRepositoryInterface {
  insertCard: (params: CardInsertInput) => Promise<DbCard>
  insertCardForHighlightIdempotent: (params: CardInsertInput & { highlightId: string }) => Promise<DbCard>
  listBySessionId: (studySessionId: string, status?: CardStatus) => Promise<DbCardWithChunk[]>
  findById: (id: string) => Promise<DbCardWithChunk | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbCardWithChunk | null>
  findByHighlightId: (highlightId: string) => Promise<DbCardWithChunk | null>
  updateStatus: (id: string, status: CardStatus) => Promise<DbCard | null>
  updateStatusBatch: (studySessionId: string, cardIds: string[], status: CardStatus) => Promise<DbCard[]>
  updateFields: (id: string, patch: CardFieldsPatch) => Promise<DbCard | null>
  listKeptForSession: (studySessionId: string) => Promise<DbCardWithChunk[]>
}

export const CardsRepository = (): CardsRepositoryInterface => {
  return {
    insertCard,
    insertCardForHighlightIdempotent,
    listBySessionId,
    findById,
    findByIdForUser,
    findByHighlightId,
    updateStatus,
    updateStatusBatch,
    updateFields,
    listKeptForSession,
  }
}
