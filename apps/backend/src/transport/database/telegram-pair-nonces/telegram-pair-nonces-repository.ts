import { sql, beginTx } from '../postgres-client'

export type TelegramPairNonceRecord = {
  nonce: string
  chat_id: string
  telegram_user_id: string | null
  expires_at: string
  claimed_by: string | null
  claimed_at: string | null
  created_at: string
}

export type ClaimAndPairResult = { ok: true; chatId: string } | { ok: false; reason: 'invalid-nonce' | 'user-missing' }

// Reuse a live unclaimed nonce for the chat instead of minting a new row per
// message: the pairing link stays stable while the user works through signup.
const getOrCreateForChat = async (
  chatId: string,
  telegramUserId: string | null,
  ttlSeconds: number
): Promise<string> => {
  const existing = (await sql`
    SELECT nonce FROM public.telegram_pair_nonces
    WHERE chat_id = ${chatId} AND claimed_by IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `) as { nonce: string }[]
  if (existing[0]) return existing[0].nonce

  const inserted = (await sql`
    INSERT INTO public.telegram_pair_nonces (chat_id, telegram_user_id, expires_at)
    VALUES (${chatId}, ${telegramUserId}, NOW() + (${ttlSeconds} || ' seconds')::interval)
    RETURNING nonce
  `) as { nonce: string }[]
  return inserted[0].nonce
}

// Atomically claims the nonce and pairs its chat to the user. Stealing the
// chat id from a previous owner keeps the one-user-per-chat invariant while
// letting a chat re-pair to a different account. Everything runs in one
// transaction so a failed pair rolls back the claim (the nonce stays usable —
// e.g. when the public.users row hasn't been created yet and the page retries).
const claimAndPair = async (nonce: string, userId: string): Promise<ClaimAndPairResult> =>
  beginTx(async (tx) => {
    const claimed = (await tx`
      UPDATE public.telegram_pair_nonces
      SET claimed_by = ${userId}, claimed_at = NOW()
      WHERE nonce = ${nonce} AND claimed_by IS NULL AND expires_at > NOW()
      RETURNING chat_id::text AS chat_id
    `) as { chat_id: string }[]
    if (!claimed[0]) return { ok: false, reason: 'invalid-nonce' } as const

    const chatId = claimed[0].chat_id
    await tx`
      UPDATE public.users SET telegram_chat_id = NULL WHERE telegram_chat_id = ${chatId}
    `
    const paired = await tx`
      UPDATE public.users SET telegram_chat_id = ${chatId} WHERE id = ${userId}
    `
    if (paired.count !== 1) {
      throw new RollbackToUserMissing()
    }
    return { ok: true, chatId } as const
  }).catch((error: unknown) => {
    if (error instanceof RollbackToUserMissing) return { ok: false, reason: 'user-missing' } as const
    throw error
  })

class RollbackToUserMissing extends Error {}

const deleteExpired = async (): Promise<number> => {
  const result = await sql`
    DELETE FROM public.telegram_pair_nonces
    WHERE expires_at < NOW()
  `
  return result.count ?? 0
}

export interface TelegramPairNoncesRepositoryInterface {
  getOrCreateForChat: (chatId: string, telegramUserId: string | null, ttlSeconds: number) => Promise<string>
  claimAndPair: (nonce: string, userId: string) => Promise<ClaimAndPairResult>
  deleteExpired: () => Promise<number>
}

export const TelegramPairNoncesRepository = (): TelegramPairNoncesRepositoryInterface => ({
  getOrCreateForChat,
  claimAndPair,
  deleteExpired,
})
