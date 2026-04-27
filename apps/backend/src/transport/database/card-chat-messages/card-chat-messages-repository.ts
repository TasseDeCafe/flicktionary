import { sql } from '../postgres-client'
import { logCustomErrorMessageAndError } from '../../third-party/sentry/error-monitoring'
import { Tables, Database } from '../database.public.types'

export type DbCardChatMessage = Tables<'card_chat_messages'>
export type CardChatRole = Database['public']['Enums']['card_chat_role']

const insertMessage = async (params: {
  cardId: string
  role: CardChatRole
  content: string
}): Promise<DbCardChatMessage | null> => {
  try {
    const result = (await sql`
      INSERT INTO public.card_chat_messages (card_id, role, content)
      VALUES (${params.cardId}, ${params.role}, ${params.content})
      RETURNING *
    `) as DbCardChatMessage[]
    return result[0] ?? null
  } catch (e) {
    logCustomErrorMessageAndError(`cardChat.insertMessage, cardId = ${params.cardId}`, e)
    return null
  }
}

const listByCardId = async (cardId: string): Promise<DbCardChatMessage[]> => {
  try {
    const result = (await sql`
      SELECT * FROM public.card_chat_messages
      WHERE card_id = ${cardId}
      ORDER BY created_at ASC
    `) as DbCardChatMessage[]
    return result
  } catch (e) {
    logCustomErrorMessageAndError(`cardChat.listByCardId, cardId = ${cardId}`, e)
    return []
  }
}

export interface CardChatMessagesRepositoryInterface {
  insertMessage: (params: { cardId: string; role: CardChatRole; content: string }) => Promise<DbCardChatMessage | null>
  listByCardId: (cardId: string) => Promise<DbCardChatMessage[]>
}

export const CardChatMessagesRepository = (): CardChatMessagesRepositoryInterface => {
  return {
    insertMessage,
    listByCardId,
  }
}
