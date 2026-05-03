import { Router } from 'express'
import { implement } from '@orpc/server'
import { checkoutContract } from '@flicktionary/api-client/orpc-contracts/checkout-contract'
import { StripeServiceInterface } from '../../service/stripe-service/stripe-service-interface'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'

export const CheckoutRouter = (stripeService: StripeServiceInterface): Router => {
  const implementer = implement(checkoutContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

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

      // The service returns null when the user record can't be found or
      // updated locally — both are domain failures (auth desync, DB race),
      // not infra throws. Surface as 500 since there's no recovery from
      // here; the boundary middleware would do the same for a thrown error.
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
