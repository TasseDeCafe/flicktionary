import { oc } from '@orpc/contract'
import { z } from 'zod'

export const CHECKOUT_PATH = '/payment/create-checkout-session' as const

const planIntervalSchema = z.enum(['month', 'year'])

export const checkoutInputSchema = z.object({
  successPathAndHash: z.string(),
  cancelPathAndHash: z.string(),
  planInterval: planIntervalSchema,
})

export const checkoutContract = {
  createCheckoutSession: oc
    .route({
      method: 'POST',
      path: CHECKOUT_PATH,
      successStatus: 200,
    })
    .input(checkoutInputSchema)
    .errors({
      INTERNAL_SERVER_ERROR: {
        status: 500,
        data: z.object({
          errors: z.array(
            z.object({
              message: z.string(),
            })
          ),
        }),
      },
    })
    .output(
      z.object({
        data: z.object({
          url: z.string(),
        }),
      })
    ),
} as const
