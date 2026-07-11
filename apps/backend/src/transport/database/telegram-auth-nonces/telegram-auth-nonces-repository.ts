import { sql } from '../postgres-client'

// Single-use sign-in nonces carried by the links the bot sends to paired
// users. Unlike pairing nonces (bound to a chat, reused while live), every
// link mints a fresh nonce bound to a user, because consumption is one-shot.
const createForUser = async (userId: string, ttlSeconds: number): Promise<string> => {
  const inserted = (await sql`
    INSERT INTO public.telegram_auth_nonces (user_id, expires_at)
    VALUES (${userId}, NOW() + (${ttlSeconds} || ' seconds')::interval)
    RETURNING nonce
  `) as { nonce: string }[]
  return inserted[0].nonce
}

// Atomically burns the nonce: the UPDATE only matches an unconsumed, unexpired
// row, so concurrent exchanges can't both win.
const consume = async (nonce: string): Promise<{ userId: string } | null> => {
  const consumed = (await sql`
    UPDATE public.telegram_auth_nonces
    SET consumed_at = NOW()
    WHERE nonce = ${nonce} AND consumed_at IS NULL AND expires_at > NOW()
    RETURNING user_id
  `) as { user_id: string }[]
  if (!consumed[0]) return null
  return { userId: consumed[0].user_id }
}

const deleteExpired = async (): Promise<number> => {
  const result = await sql`
    DELETE FROM public.telegram_auth_nonces
    WHERE expires_at < NOW()
  `
  return result.count ?? 0
}

// Test-only helper (integration tests reset state between cases).
export const __deleteAllTelegramAuthNonces = async (): Promise<void> => {
  await sql`DELETE FROM public.telegram_auth_nonces`
}

export interface TelegramAuthNoncesRepositoryInterface {
  createForUser: (userId: string, ttlSeconds: number) => Promise<string>
  consume: (nonce: string) => Promise<{ userId: string } | null>
  deleteExpired: () => Promise<number>
}

export const TelegramAuthNoncesRepository = (): TelegramAuthNoncesRepositoryInterface => ({
  createForUser,
  consume,
  deleteExpired,
})
