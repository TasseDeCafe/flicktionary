import { Router } from 'express'
import { implement } from '@orpc/server'
import { coverageContract } from '@flicktionary/api-client/orpc-contracts/coverage-contract'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { type OrpcContext } from '../orpc/orpc-context'
import { getUserCoverage, type CoverageDependencies } from '../../service/coverage/get-user-coverage'

// Whole-language vocabulary coverage (the dashboard grid + detail view).
// TOP_LEMMAS_LIMIT bounds the tooltip payload to the head of the frequency
// list — the dots people actually hover — at ~40–60KB per language.
const TOP_LEMMAS_LIMIT = 5000

export const CoverageRouter = (dependencies: CoverageDependencies): Router => {
  const implementer = implement(coverageContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    getCoverage: implementer.getCoverage.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const languages = await getUserCoverage({ userId }, dependencies)
      return { data: { languages } }
    }),

    getTopLemmas: implementer.getTopLemmas.handler(async ({ input, errors }) => {
      const build = await dependencies.lemmaRanksRepository.getTopLemmasBuild({
        targetLanguage: input.targetLanguage,
        limit: TOP_LEMMAS_LIMIT,
      })
      if (!build) {
        throw errors.NOT_FOUND({
          data: { errors: [{ message: 'No frequency data for this language' }] },
        })
      }
      return { data: { buildVersion: build.version, lemmas: build.lemmas } }
    }),
  })

  return createOrpcExpressRouter(router)
}
