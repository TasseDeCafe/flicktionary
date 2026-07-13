import { sql } from '../postgres-client'

export type TelegramPendingImportRecord = {
  chat_id: string
  message_text: string
  suggested_title: string
  expires_at: string
  created_at: string
}

// One pending import per chat: a newer message replaces the previous one.
const upsertForChat = async (params: {
  chatId: string
  messageText: string
  suggestedTitle: string
  ttlSeconds: number
}): Promise<void> => {
  await sql`
    INSERT INTO public.telegram_pending_imports (chat_id, message_text, suggested_title, expires_at)
    VALUES (
      ${params.chatId},
      ${params.messageText},
      ${params.suggestedTitle},
      NOW() + (${params.ttlSeconds} || ' seconds')::interval
    )
    ON CONFLICT (chat_id) DO UPDATE
    SET message_text = EXCLUDED.message_text,
        suggested_title = EXCLUDED.suggested_title,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
  `
}

// Atomic pop: the DELETE ... RETURNING guarantees a pending import resumes at
// most once even if two triggers race (e.g. a double-tapped CEFR button).
const popForChat = async (chatId: string): Promise<TelegramPendingImportRecord | null> => {
  const result = (await sql`
    DELETE FROM public.telegram_pending_imports
    WHERE chat_id = ${chatId} AND expires_at > NOW()
    RETURNING chat_id::text AS chat_id, message_text, suggested_title, expires_at, created_at
  `) as TelegramPendingImportRecord[]
  return result[0] ?? null
}

const deleteExpired = async (): Promise<number> => {
  const result = await sql`
    DELETE FROM public.telegram_pending_imports
    WHERE expires_at < NOW()
  `
  return result.count ?? 0
}

export interface TelegramPendingImportsRepositoryInterface {
  upsertForChat: (params: {
    chatId: string
    messageText: string
    suggestedTitle: string
    ttlSeconds: number
  }) => Promise<void>
  popForChat: (chatId: string) => Promise<TelegramPendingImportRecord | null>
  deleteExpired: () => Promise<number>
}

export const TelegramPendingImportsRepository = (): TelegramPendingImportsRepositoryInterface => ({
  upsertForChat,
  popForChat,
  deleteExpired,
})
