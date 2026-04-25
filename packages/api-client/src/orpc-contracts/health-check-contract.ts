import { oc } from '@orpc/contract'
import { z } from 'zod'

export const HEALTH_CHECK_PATH = '/health-check' as const
export const DATABASE_HEALTH_CHECK_PATH = '/database-health-check' as const

export const healthCheckContract = {
  getHealthCheck: oc
    .route({
      method: 'GET',
      path: HEALTH_CHECK_PATH,
      successStatus: 200,
    })
    .output(
      z.object({
        data: z.object({
          isHealthy: z.boolean(),
          gitCommit: z.string(),
        }),
      })
    ),
  getDatabaseHealthCheck: oc
    .route({
      method: 'GET',
      path: DATABASE_HEALTH_CHECK_PATH,
      successStatus: 200,
    })
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
          isDatabaseConnectionHealthy: z.boolean(),
          gitCommit: z.string(),
        }),
      })
    ),
} as const
