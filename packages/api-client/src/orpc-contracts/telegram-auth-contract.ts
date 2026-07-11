import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

export const telegramAuthContract = {
  // Unauthenticated by design: the nonce IS the credential. The bot appends it
  // to session links (`?auth=<nonce>`) so they sign the user in wherever they
  // are opened — Telegram's in-app browser shares no cookies with the real
  // browser. The web app POSTs the nonce (link-preview crawlers only GET, so
  // they can't burn it), gets back a Supabase magic-link token_hash, and
  // redeems it client-side with verifyOtp.
  exchangeNonce: oc
    .route({ method: 'POST', path: '/telegram-auth/exchange-nonce', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      // Consumed, expired, or unknown nonce — the caller falls back to the
      // normal login screen.
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
    })
    .input(z.object({ nonce: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          tokenHash: z.string(),
          email: z.string().email(),
        }),
      })
    ),
} as const
