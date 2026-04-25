import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { sentryDebugContract } from '@template-app/api-client/orpc-contracts/sentry-debug-contract'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'

export const SentryDebugRouter = (): Router => {
  const implementer = implement(sentryDebugContract).$context<OrpcContext>()

  const router = implementer.router({
    triggerSentryMessage: implementer.triggerSentryMessage.handler(async ({ input }) => {
      const { message, isInfoLevel = false } = input
      logWithSentry({
        message: message,
        isInfoLevel: isInfoLevel,
      })

      return {
        data: {
          success: true,
          message: 'Sentry message triggered successfully',
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: sentryDebugContract })
}
