import { Router } from 'express'
import { implement } from '@orpc/server'
import { statsContract } from '@flicktionary/api-client/orpc-contracts/stats-contract'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { type OrpcContext } from '../orpc/orpc-context'
import { getActivity, type StatsDependencies } from '../../service/stats/get-activity'

// Per-day study activity + streak for the dashboard/stats charts.
export const StatsRouter = (dependencies: StatsDependencies): Router => {
  const implementer = implement(statsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    getActivity: implementer.getActivity.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const activity = await getActivity({ userId }, dependencies)
      return { data: activity }
    }),
  })

  return createOrpcExpressRouter(router)
}
