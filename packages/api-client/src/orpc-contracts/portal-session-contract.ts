import { oc } from '@orpc/contract'
import { z } from 'zod'

export const PORTAL_SESSION_PATH = '/payment/create-customer-portal-session' as const

const errorResponseSchema = z.object({
  errors: z.array(
    z.object({
      message: z.string(),
    })
  ),
})

export const portalSessionContract = {
  createCustomerPortalSession: oc
    .route({
      method: 'POST',
      path: PORTAL_SESSION_PATH,
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: {
        status: 404,
        data: errorResponseSchema,
      },
      INTERNAL_SERVER_ERROR: {
        status: 500,
        data: errorResponseSchema,
      },
    })
    .input(
      z.object({
        returnPath: z.string(),
      })
    )
    .output(
      z.object({
        data: z.object({
          url: z.string(),
        }),
      })
    ),
} as const
