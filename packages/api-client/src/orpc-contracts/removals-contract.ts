import { oc } from '@orpc/contract'
import { z } from 'zod'

export const REMOVALS_PATH = '/removals' as const

const errorResponseSchema = z.object({
  errors: z.array(
    z.object({
      message: z.string(),
      code: z.string().optional(),
    })
  ),
})

export const removalsContract = {
  postRemoval: oc
    .route({
      method: 'POST',
      path: REMOVALS_PATH,
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
    .output(
      z.object({
        data: z.object({
          message: z.string(),
          isSuccess: z.boolean(),
        }),
      })
    ),
} as const
