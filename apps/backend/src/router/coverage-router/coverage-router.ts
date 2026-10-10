import { Router } from 'express'
import { implement } from '@orpc/server'
import { coverageContract } from '@flicktionary/api-client/orpc-contracts/coverage-contract'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { type OrpcContext } from '../orpc/orpc-context'
import { getUserCoverage, type CoverageDependencies } from '../../service/coverage/get-user-coverage'

// Whole-language vocabulary coverage (the dashboard grid + detail view).

export const CoverageRouter = (dependencies: CoverageDependencies): Router => {
  const implementer = implement(coverageContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    getCoverage: implementer.getCoverage.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const languages = await getUserCoverage({ userId }, dependencies)
      return { data: { languages } }
    }),

    // Deliberately uncapped so every dot on the wall can name its lemma: the
    // largest list (English, ~60k lemmas) is ~0.6MB of JSON before compression
    // and the client caches it per rank build. If this payload ever becomes a
    // problem, cap it here — the tooltip already falls back to rank + state
    // for any rank without a label.
    getTopLemmas: implementer.getTopLemmas.handler(async ({ input, errors }) => {
      const build = await dependencies.lemmaRanksRepository.getTopLemmasBuild({
        targetLanguage: input.targetLanguage,
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
