import { execSync } from 'child_process'
import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { sql } from '../../transport/database/postgres-client'
import { healthCheckContract } from '@template-app/api-client/orpc-contracts/health-check-contract'

const getGitCommit = (): string => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    // In production containers, .git may not be available
    return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown'
  }
}

export const HealthCheckRouter = (): Router => {
  const implementer = implement(healthCheckContract).$context<OrpcContext>()

  const router = implementer.router({
    getHealthCheck: implementer.getHealthCheck.handler(async () => {
      return {
        data: {
          isHealthy: true,
          gitCommit: getGitCommit(),
        },
      }
    }),

    getDatabaseHealthCheck: implementer.getDatabaseHealthCheck.handler(async ({ errors }) => {
      try {
        await sql`SELECT 1`
        return {
          data: {
            isDatabaseConnectionHealthy: true,
            gitCommit: getGitCommit(),
          },
        }
      } catch {
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [{ message: 'Database connection failed' }],
          },
        })
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: healthCheckContract })
}
