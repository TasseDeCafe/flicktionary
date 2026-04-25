import { oc } from '@orpc/contract'
import { z } from 'zod'

const errorResponseSchema = z.object({
  errors: z.array(
    z.object({
      message: z.string(),
      code: z.string().optional(),
    })
  ),
})

export const authenticationContract = {
  sendEmailVerification: oc
    .route({
      method: 'POST',
      path: '/authentication/send-email-verification',
      successStatus: 200,
    })
    .errors({
      INTERNAL_SERVER_ERROR: {
        status: 500,
        data: errorResponseSchema,
      },
    })
    .input(
      z.object({
        email: z.email(),
        referral: z.string().nullable(),
        utmSource: z.string().nullable(),
        utmMedium: z.string().nullable(),
        utmCampaign: z.string().nullable(),
        utmTerm: z.string().nullable(),
        utmContent: z.string().nullable(),
        platform: z.enum(['web', 'native']).default('web'),
      })
    )
    .output(
      z.object({
        data: z.object({
          message: z.string(),
        }),
      })
    ),
} as const
