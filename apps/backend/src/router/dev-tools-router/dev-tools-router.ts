import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { assertTestUser } from '../orpc/helpers/assert-test-user'
import { devToolsContract } from '@flicktionary/api-client/orpc-contracts/dev-tools-contract'
import { sql } from '../../transport/database/postgres-client'
import { shiftPracticeTimestamps } from '../../transport/database/dev-tools/shift-practice-timestamps'

export const DevToolsRouter = (): Router => {
  const implementer = implement(devToolsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    advancePracticeClock: implementer.advancePracticeClock.handler(async ({ input, context }) => {
      assertTestUser(context.res.locals.email)
      const userId = context.res.locals.userId as string

      // Scoped to the caller's own rows — safe to expose in any environment,
      // including prod for a test account.
      const results = await shiftPracticeTimestamps(sql, { days: input.days, userId })

      return {
        data: {
          tables: results.map(({ table, rowsShifted }) => ({ table, rowsShifted })),
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: devToolsContract })
}
