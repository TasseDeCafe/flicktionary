import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

export const telegramPairContract = {
  // Pairs the authenticated user with the Telegram chat a nonce was minted
  // for. Claim and resume are deliberately separate procedures: at claim time
  // a fresh signup has no native language yet, so the pending import must
  // only resume after onboarding (completePending).
  claim: oc
    .route({ method: 'POST', path: '/telegram-pair/claim', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      // Used or expired nonce — the user gets a fresh link by messaging the bot.
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      // The public.users row doesn't exist yet (UserSetupGate still creating
      // it). The claim rolled back, so the same nonce can be retried.
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
    })
    .input(z.object({ nonce: z.string().uuid() }))
    .output(z.object({ data: z.object({ paired: z.literal(true) }) })),

  // Fires the stashed pending import for the user's paired chat (if any).
  // accepted=false when the user has no Telegram chat linked.
  completePending: oc
    .route({ method: 'POST', path: '/telegram-pair/complete-pending', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({}).optional())
    .output(z.object({ data: z.object({ accepted: z.boolean() }) })),
} as const
