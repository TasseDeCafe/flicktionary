import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { configContract } from '@template-app/api-client/orpc-contracts/config-contract'

const CONFIG = {
  lowestSupportedVersionIos: '0.0.1',
  lowestSupportedVersionAndroid: '0.0.1',
}

export const configRouter = (): Router => {
  const implementer = implement(configContract).$context<OrpcContext>()

  const router = implementer.router({
    getConfig: implementer.getConfig.handler(async () => {
      return {
        data: {
          lowestSupportedVersionIos: CONFIG.lowestSupportedVersionIos,
          lowestSupportedVersionAndroid: CONFIG.lowestSupportedVersionAndroid,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: configContract })
}
