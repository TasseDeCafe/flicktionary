import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

const BootstrapPrefsSchema = z.object({
  primaryTargetLanguage: z.string().nullable(),
  nativeLanguage: z.string().nullable(),
  cefrLevel: z.string().nullable(),
  email: z.string().email(),
  isOnboarded: z.boolean(),
})

export const extensionAuthContract = {
  mintSession: oc
    .route({ method: 'POST', path: '/extension-auth/mint-session', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
    })
    .input(z.object({ nonce: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          tokenHash: z.string(),
          email: z.string().email(),
        }),
      }),
    ),

  revokeSession: oc
    .route({ method: 'POST', path: '/extension-auth/revoke-session', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({}).optional())
    .output(z.object({ data: z.object({ revoked: z.boolean() }) })),

  bootstrapPrefs: oc
    .route({ method: 'GET', path: '/extension-auth/bootstrap-prefs', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .output(z.object({ data: BootstrapPrefsSchema })),
} as const
