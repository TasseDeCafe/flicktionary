import { oc } from '@orpc/contract'
import { z } from 'zod'

export const SENTRY_DEBUG_TRIGGER_MESSAGE_PATH = '/debugging/sentry/trigger-message' as const

export const sentryDebugContract = {
  triggerSentryMessage: oc
    .route({
      method: 'POST',
      path: SENTRY_DEBUG_TRIGGER_MESSAGE_PATH,
      successStatus: 200,
    })
    .input(
      z.object({
        message: z.string(),
        isInfoLevel: z.boolean().optional(),
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
