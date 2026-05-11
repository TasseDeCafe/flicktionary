import { Router } from 'express'
import { implement } from '@orpc/server'
import { languagesContract } from '@flicktionary/api-client/orpc-contracts/languages-contract'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { languageDetectionPass } from '../../transport/third-party/anthropic/passes/language-detection-pass'

export const LanguagesRouter = (): Router => {
  const implementer = implement(languagesContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    detect: implementer.detect.handler(async ({ input }) => {
      const code = await languageDetectionPass(input.text)
      return { data: { code } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: languagesContract })
}
