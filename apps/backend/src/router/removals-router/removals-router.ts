import { Router, type NextFunction, type Request, type Response } from 'express'
import { implement } from '@orpc/server'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { insertRemoval, updateRemovalSuccess } from '../../transport/database/removals/removals-repository'
import { rateLimit } from 'express-rate-limit'
import { getConfig } from '../../config/environment-config'
import type { AuthUsersRepository } from '../../transport/database/auth-users/auth-users-repository'
import { StripeApi } from '../../transport/third-party/stripe/stripe-api'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { StripeSubscriptionsRepositoryInterface } from '../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { removalsContract } from '@template-app/api-client/orpc-contracts/removals-contract'
import { CrypticCodeConstants } from '../../constants/cryptic-code-constants'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'

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

  const implementer = implement(removalsContract).$context<OrpcContext>()

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
      let removalId: string | null

      removalId = await insertRemoval(userId, userEmail, false)
      if (!removalId) {
        logWithSentry({ message: 'could not insert removal', params: { userId } })
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [
              {
                message: `Account removal was not initiated`,
                code: CrypticCodeConstants.REMOVAL_ACCOUNT_NOT_INITIATED,
              },
            ],
          },
        })
      }

      const subscriptions = await stripeSubscriptionsRepository.getSubscriptionsByUserId(userId)
      const latestSubscription = subscriptions.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]

      if (latestSubscription?.stripe_subscription_id) {
        const isSuccessfullyCancelled = await stripeApi.cancelSubscription(latestSubscription.stripe_subscription_id)
        if (!isSuccessfullyCancelled) {
          logWithSentry({
            message: 'account removal: failed to cancel stripe subscription',
            params: { userId },
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
        logWithSentry({
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

      if (!removalId) {
        logWithSentry({
          message: 'removalId missing after processing removal request',
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

      const wasInsertToRemovalsSuccessful = await updateRemovalSuccess(removalId, true)
      if (!wasInsertToRemovalsSuccessful) {
        logWithSentry({
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
