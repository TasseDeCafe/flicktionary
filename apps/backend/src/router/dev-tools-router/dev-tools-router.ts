import { Router } from 'express'
import { implement, ORPCError } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { devToolsContract } from '@flicktionary/api-client/orpc-contracts/dev-tools-contract'
import { getConfig } from '../../config/environment-config'
import { sql } from '../../transport/database/postgres-client'
import { shiftPracticeTimestamps } from '../../transport/database/dev-tools/shift-practice-timestamps'

// Test-user-only tooling. Unlike the frontend's hashed-email route gate, this
// is the authoritative check: the endpoint mutates data, so it verifies the
// authenticated caller's email against the backend's plaintext
// EMAILS_OF_TEST_USERS before doing anything.
const assertTestUser = (email: unknown): void => {
  const normalized = String(email ?? '')
    .trim()
    .toLowerCase()
  const isTestUser =
    normalized.length > 0 && getConfig().emailsOfTestUsers.some((testEmail) => testEmail.toLowerCase() === normalized)
  if (!isTestUser) {
    throw new ORPCError('FORBIDDEN', { message: 'Dev tools are restricted to test users' })
  }
}

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
