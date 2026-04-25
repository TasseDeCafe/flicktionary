import { type Router } from 'express'
import { implement } from '@orpc/server'
import { getConfig } from '../../config/environment-config'
import { StripeApi } from '../../transport/third-party/stripe/stripe-api'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { portalSessionContract } from '@template-app/api-client/orpc-contracts/portal-session-contract'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'

export const PortalSessionRouter = (usersRepository: UsersRepositoryInterface, stripeApi: StripeApi): Router => {
  const implementer = implement(portalSessionContract).$context<OrpcContext>()

  const router = implementer.router({
    createCustomerPortalSession: implementer.createCustomerPortalSession.handler(async ({ context, input, errors }) => {
      const userId = context.res.locals.userId
      const { returnPath } = input

      const user = await usersRepository.findUserByUserId(userId)

      if (!user || !user.stripe_customer_id) {
        throw errors.NOT_FOUND({
          data: {
            errors: [{ message: 'User or Stripe customer not found' }],
          },
        })
      }

      const sessionUrl = await stripeApi.createBillingPortalUrl(
        user.stripe_customer_id,
        `${getConfig().webUrl}${returnPath}`
      )

      if (!sessionUrl) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [{ message: 'Failed to create billing portal session url' }],
          },
        })
      }

      return {
        data: {
          url: sessionUrl,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: portalSessionContract })
}
