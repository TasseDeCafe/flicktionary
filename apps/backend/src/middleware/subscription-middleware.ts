import { NextFunction, Request, Response } from 'express'
import { createResponseWithOneError } from '../router/router-utils'
import { logCustomErrorMessageAndError } from '../transport/third-party/sentry/error-monitoring'
import { getConfig } from '../config/environment-config'
import { AccessCacheServiceInterface } from '../service/long-running/subscription-cache-service/access-cache-service'
import { ORPCError } from '@orpc/server'
import { ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED } from '@template-app/api-client/key-generation/frontend-api-key-constants'

export const subscriptionMiddleware = (accessCache: AccessCacheServiceInterface, usersWithFreeAccess: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = res.locals.userId
    const email = res.locals.email

    if (getConfig().featureFlags.shouldAppBeFreeForEveryone()) {
      return next()
    }

    if (usersWithFreeAccess.includes(email)) {
      return next()
    }

    try {
      if (accessCache.hasUserId(userId)) {
        return next()
      }

      const orpcError = new ORPCError('FORBIDDEN', {
        data: {
          errors: [
            {
              code: ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED,
              message: 'NO_ACTIVE_SUBSCRIPTION',
            },
          ],
        },
      })

      res.status(orpcError.status).json(orpcError.toJSON())
      return
    } catch (error) {
      logCustomErrorMessageAndError('Error checking subscription', error)
      res.status(500).send(createResponseWithOneError('Internal server error'))
      return
    }
  }
}
