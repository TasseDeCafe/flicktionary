import { Request, Response } from 'express'
import { HandledRevenuecatEventsRepository } from '../../../transport/database/webhook-events/handled-revenuecat-events-repository'
import { getConfig } from '../../../config/environment-config'
import {
  logCustomErrorMessageAndError,
  logWithSentry,
  logMessage,
} from '../../../transport/third-party/sentry/error-monitoring'
import { AuthUsersRepository } from '../../../transport/database/auth-users/auth-users-repository'
import { RevenuecatServiceInterface } from '../../../service/revenuecat-service/revenuecat-service-interface'

export const revenuecatWebhookRouter = (
  handledRevenuecatEventsRepository: HandledRevenuecatEventsRepository,
  authUsersRepository: AuthUsersRepository,
  revenuecatService: RevenuecatServiceInterface
) => {
  return async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization

      if (!authHeader || authHeader !== getConfig().revenuecatWebhookAuthHeader) {
        logMessage('Invalid or missing RevenueCat webhook authorization header')
        res.status(401).send()
        return
      }

      const { event } = req.body

      // todo revenuecat: remove this once we're sure we will never handle transfer events,
      // currently we do not support transfer events
      const isTransferEvent: boolean = event.type === 'TRANSFER'
      const relevantUserId = isTransferEvent ? event.transferred_to?.[0] : event.app_user_id
      if (isTransferEvent) {
        const transferredFromId = event.transferred_from?.[0]
        logMessage(`Processed TRANSFER event from ${transferredFromId} to ${relevantUserId}`, true)
      }
      if (!relevantUserId) {
        logMessage(`Could not determine relevant user ID from RevenueCat event: ${event}`)
        res.status(200).send()
        return
      }
      const userExists = await authUsersRepository.findUserById(relevantUserId)

      if (!userExists) {
        logWithSentry({
          message: `Skipping RevenueCat webhook for non-existent user ${relevantUserId} from event ${event.id}. User may have been deleted or this could be stale data.`,
          params: {
            relevantUserId,
            eventType: event.type,
            isTransferEvent,
          },
        })
        return
      }

      await handledRevenuecatEventsRepository.handleEventIdempotently(event.id, async () => {
        // test webhooks can be sent from revenue cat dashboard, the 'TEST' has nothing to do with our test environment
        if (event.type === 'TEST') {
          return
        }
        await revenuecatService.syncRevenuecatSubscriptionWithOurDbAndCache(relevantUserId)
      })

      res.status(200).send()
    } catch (error) {
      logCustomErrorMessageAndError('Error processing RevenueCat webhook', error)
      res.status(400).send()
    }
  }
}
