import { Router } from 'express'
import { implement } from '@orpc/server'
import { checkoutContract } from '@template-app/api-client/orpc-contracts/checkout-contract'
import { StripeServiceInterface } from '../../service/stripe-service/stripe-service-interface'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'

export const CheckoutRouter = (stripeService: StripeServiceInterface): Router => {
  const implementer = implement(checkoutContract).$context<OrpcContext>()

  const router = implementer.router({
    createCheckoutSession: implementer.createCheckoutSession.handler(async ({ input, context, errors }) => {
      const { userId, email } = context.res.locals
      const url = await stripeService.createCheckoutSession(
        userId,
        email,
        input.successPathAndHash,
        input.cancelPathAndHash,
        input.planInterval
      )

      if (!url) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [{ message: 'Failed to create checkout session' }],
          },
        })
      }

      return {
        data: {
          url,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: checkoutContract })
}
