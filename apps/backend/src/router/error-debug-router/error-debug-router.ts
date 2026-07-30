import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { assertTestUser } from '../orpc/helpers/assert-test-user'
import { errorDebugContract } from '@flicktionary/api-client/orpc-contracts/error-debug-contract'
import { logError } from '../../transport/error-monitoring/error-monitoring'

export const ErrorDebugRouter = (): Router => {
  const implementer = implement(errorDebugContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    triggerErrorMessage: implementer.triggerErrorMessage.handler(async ({ input, context }) => {
      assertTestUser(context.res.locals.email)
      logError({
        message: input.message,
        error: new Error(input.message),
      })

      return {
        data: {
          success: true,
          message: 'Test error triggered successfully',
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: errorDebugContract })
}
