import { sql } from '../postgres-client'

export type ExtensionPairNonceRecord = {
  nonce: string
  user_id: string
  expires_at: string
  consumed_at: string | null
  created_at: string
}

const claim = async (nonce: string, userId: string, ttlSeconds: number): Promise<ExtensionPairNonceRecord | null> => {
  const result = (await sql`
    INSERT INTO public.extension_pair_nonces (nonce, user_id, expires_at)
    VALUES (${nonce}, ${userId}, NOW() + (${ttlSeconds} || ' seconds')::interval)
    ON CONFLICT (nonce) DO NOTHING
    RETURNING *
  `) as ExtensionPairNonceRecord[]
  return result[0] ?? null
}

const deleteExpired = async (): Promise<number> => {
  const result = await sql`
    DELETE FROM public.extension_pair_nonces
    WHERE expires_at < NOW()
  `
  return result.count ?? 0
}

export interface ExtensionPairNoncesRepositoryInterface {
  claim: (nonce: string, userId: string, ttlSeconds: number) => Promise<ExtensionPairNonceRecord | null>
  deleteExpired: () => Promise<number>
}

export const ExtensionPairNoncesRepository = (): ExtensionPairNoncesRepositoryInterface => ({
  claim,
  deleteExpired,
})
