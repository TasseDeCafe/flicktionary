import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbCardChatMessage = Tables<'card_chat_messages'>
export type CardChatRole = Database['public']['Enums']['card_chat_role']

const insertMessage = async (params: {
  cardId: string
  role: CardChatRole
  content: string
}): Promise<DbCardChatMessage> => {
  const result = (await sql`
    INSERT INTO public.card_chat_messages (card_id, role, content)
    VALUES (${params.cardId}, ${params.role}, ${params.content})
    RETURNING *
  `) as DbCardChatMessage[]
  return result[0]!
}

// Conflict-safe insert for a worker-seeded turn. Keyed by (card_id,
// source_turn_key, role) via uq_card_chat_messages_source_turn, so a worker that
// retries after a partial insert re-reads the already-stored row instead of
// duplicating the visible message. Returns the inserted-or-existing row.
const insertSeededMessage = async (params: {
  cardId: string
  role: CardChatRole
  content: string
  source: string
  sourceTurnKey: string
}): Promise<DbCardChatMessage> => {
  const inserted = (await sql`
    INSERT INTO public.card_chat_messages (card_id, role, content, source, source_turn_key)
    VALUES (${params.cardId}, ${params.role}, ${params.content}, ${params.source}, ${params.sourceTurnKey})
    ON CONFLICT (card_id, source_turn_key, role) WHERE source_turn_key IS NOT NULL
    DO NOTHING
    RETURNING *
  `) as DbCardChatMessage[]
  if (inserted[0]) return inserted[0]
  const existing = (await sql`
    SELECT * FROM public.card_chat_messages
    WHERE card_id = ${params.cardId} AND source_turn_key = ${params.sourceTurnKey} AND role = ${params.role}
  `) as DbCardChatMessage[]
  return existing[0]!
}

// Has a seeded turn for this key already produced an assistant reply? Used as the
// pre-LLM idempotency gate so a replayed seed job does not call Opus twice.
const findSeededAssistant = async (cardId: string, sourceTurnKey: string): Promise<DbCardChatMessage | null> => {
  const result = (await sql`
    SELECT * FROM public.card_chat_messages
    WHERE card_id = ${cardId} AND source_turn_key = ${sourceTurnKey} AND role = 'assistant'
  `) as DbCardChatMessage[]
  return result[0] ?? null
}

const listByCardId = async (cardId: string): Promise<DbCardChatMessage[]> => {
  return (await sql`
    SELECT * FROM public.card_chat_messages
    WHERE card_id = ${cardId}
    ORDER BY created_at ASC
  `) as DbCardChatMessage[]
}

export interface CardChatMessagesRepositoryInterface {
  insertMessage: (params: { cardId: string; role: CardChatRole; content: string }) => Promise<DbCardChatMessage>
  insertSeededMessage: (params: {
    cardId: string
    role: CardChatRole
    content: string
    source: string
    sourceTurnKey: string
  }) => Promise<DbCardChatMessage>
  findSeededAssistant: (cardId: string, sourceTurnKey: string) => Promise<DbCardChatMessage | null>
  listByCardId: (cardId: string) => Promise<DbCardChatMessage[]>
}

export const CardChatMessagesRepository = (): CardChatMessagesRepositoryInterface => {
  return {
    insertMessage,
    insertSeededMessage,
    findSeededAssistant,
    listByCardId,
  }
}
