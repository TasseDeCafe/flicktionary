import { orpcClient } from '@/lib/transport/orpc-client'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { useAuthStore } from '@/stores/auth-store'

// Links from the Telegram bot carry a single-use sign-in nonce (?auth=<nonce>)
// so they work in browsers with no existing session — Telegram's in-app
// browser shares no cookies with the user's real browser. The nonce is
// exchanged for a Supabase magic-link token_hash and redeemed on the spot.
// Returns false on any failure (expired/used nonce, network) so the caller
// falls back to the normal login redirect.
export const signInWithTelegramNonce = async (nonce: string): Promise<boolean> => {
  try {
    const { data } = await orpcClient.telegramAuth.exchangeNonce({ nonce })
    const { data: verified, error } = await supabaseClient.auth.verifyOtp({
      token_hash: data.tokenHash,
      type: 'magiclink',
    })
    if (error || !verified.session) {
      return false
    }
    useAuthStore.getState().setSession(verified.session)
    return true
  } catch {
    return false
  }
}
