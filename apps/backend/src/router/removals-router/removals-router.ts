import { Router, type NextFunction, type Request, type Response } from 'express'
import { implement } from '@orpc/server'
import { logError } from '../../transport/error-monitoring/error-monitoring'
import { insertRemoval, updateRemovalSuccess } from '../../transport/database/removals/removals-repository'
import { rateLimit } from 'express-rate-limit'
import { getConfig } from '../../config/environment-config'
import type { AuthUsersRepository } from '../../transport/database/auth-users/auth-users-repository'
import { StripeApi } from '../../transport/third-party/stripe/stripe-api'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { StripeSubscriptionsRepositoryInterface } from '../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { removalsContract } from '@flicktionary/api-client/orpc-contracts/removals-contract'
import { CrypticCodeConstants } from '../../constants/cryptic-code-constants'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'

export const removalsRouter = (
  authUsersRepository: AuthUsersRepository,
  usersRepository: UsersRepositoryInterface,
  stripeApi: StripeApi,
  stripeSubscriptionsRepository: StripeSubscriptionsRepositoryInterface
) => {
  const expressRouter: Router = Router()

  const oneHour = 1000 * 60 * 60
  const fiveRequestsInOneHourRateLimit = rateLimit({
    windowMs: oneHour,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })

  const conditionalRateLimitingMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (getConfig().shouldRateLimit) {
      return fiveRequestsInOneHourRateLimit(req, res, next)
    }
    return next()
  }

  expressRouter.use('/removals', conditionalRateLimitingMiddleware)

  const implementer = implement(removalsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    postRemoval: implementer.postRemoval.handler(async ({ context, errors }) => {
      const { res } = context
      const userId = res.locals.userId
      const userEmail = res.locals.email

      const dbUser = await usersRepository.findUserByUserId(userId)
      if (!dbUser) {
        throw errors.NOT_FOUND({
          data: {
            errors: [{ message: 'User not found' }],
          },
        })
      }
      const removalId = await insertRemoval(userId, userEmail, false)

      const subscriptions = await stripeSubscriptionsRepository.getSubscriptionsByUserId(userId)
      const latestSubscription = subscriptions.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]

      if (latestSubscription?.stripe_subscription_id) {
        // Per-step try/catch is deliberate: removals routes carry user-facing
        // cryptic codes that the global error-boundary middleware would erase
        // by collapsing every throw into a generic INTERNAL_SERVER_ERROR.
        try {
          await stripeApi.cancelSubscription(latestSubscription.stripe_subscription_id)
        } catch (error) {
          logError({
            message: 'account removal: failed to cancel stripe subscription',
            params: { userId },
            error,
          })
          throw errors.INTERNAL_SERVER_ERROR({
            data: {
              errors: [
                {
                  message: 'account removal did not fully succeed',
                  code: CrypticCodeConstants.REMOVAL_ACCOUNT_STRIPE_CANCEL_FAILED,
                },
              ],
            },
          })
        }
      }

      const isSuccessfullyRemovedFromAuthUsers = await authUsersRepository.removeUserFromAuthUsers(userId)
      if (!isSuccessfullyRemovedFromAuthUsers) {
        logError({
          message: 'account removal: failed to remove user from authUsers',
          params: { userId },
        })
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [
              {
                message: 'account removal did not fully succeed',
                code: CrypticCodeConstants.REMOVAL_ACCOUNT_AUTH_USERS_DELETE_FAILED,
              },
            ],
          },
        })
      }

      const wasInsertToRemovalsSuccessful = await updateRemovalSuccess(removalId, true)
      if (!wasInsertToRemovalsSuccessful) {
        logError({
          message: 'account removal: failed to insert removal success',
          params: { userId, removalId },
        })
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [
              {
                message: `Account removal did not fully succeed`,
                code: CrypticCodeConstants.REMOVAL_UPDATE_SUCCESS_FAILED,
              },
            ],
          },
        })
      }

      return {
        data: {
          message: 'Removal has been executed successfully',
          isSuccess: true,
        },
      }
    }),
  })

  expressRouter.use(createOrpcExpressRouter(router, { contract: removalsContract }))

  return expressRouter
}
