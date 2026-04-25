import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { logMessage } from '../../transport/third-party/sentry/error-monitoring'
import type { BillingServiceInterface } from '../../service/get-subscription-account-data-service/billing-service'
import { billingContract, GetSubscriptionInfoResponse } from '@template-app/api-client/orpc-contracts/billing-contract'

export const BillingRouter = (billingService: BillingServiceInterface, usersWithFreeAccess: string[]): Router => {
  const implementer = implement(billingContract).$context<OrpcContext>()

  const router = implementer.router({
    getSubscriptionDetails: implementer.getSubscriptionDetails.handler(async ({ context, errors }) => {
      const userId = context.res.locals.userId
      const userEmail = context.res.locals.email

      if (usersWithFreeAccess.includes(userEmail)) {
        const responseData: GetSubscriptionInfoResponse = {
          stripeDetails: null,
          revenueCatDetails: null,
          isPremiumUser: true,
          billingPlatform: null,
          isSpecialUserWithFullAccess: true,
        }
        return {
          data: responseData,
        }
      }

      const billingData = await billingService.getBillingData(userId)

      if (!billingData) {
        logMessage(`subscriptionAccountRouter: User not found for userId - ${userId}`)
        throw errors.NOT_FOUND({
          data: {
            errors: [{ message: 'Error fetching subscription details', code: '20' }],
          },
        })
      }

      const responseData: GetSubscriptionInfoResponse = billingData
      return {
        data: responseData,
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: billingContract })
}
