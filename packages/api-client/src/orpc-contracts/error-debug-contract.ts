import { oc } from '@orpc/contract'
import { z } from 'zod'

export const ERROR_DEBUG_TRIGGER_MESSAGE_PATH = '/debugging/error-monitoring/trigger-message' as const

// Admin-only smoke test for backend error monitoring: triggers a handled
// error log so the capture pipeline can be verified end to end.
export const errorDebugContract = {
  triggerErrorMessage: oc
    .route({
      method: 'POST',
      path: ERROR_DEBUG_TRIGGER_MESSAGE_PATH,
      successStatus: 200,
    })
    .input(
      z.object({
        message: z.string(),
      })
    )
    .output(
      z.object({
        data: z.object({
          success: z.boolean(),
          message: z.string(),
        }),
      })
    ),
} as const
