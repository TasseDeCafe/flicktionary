import { Request, Response } from 'express'
import { getConfig } from '../../../config/environment-config'
import { logMessage } from '../../../transport/error-monitoring/error-monitoring'
import { handleTelegramUpdate, TelegramBotDependencies } from '../../../service/telegram-bot/handle-telegram-update'
import { TelegramUpdate } from '../../../transport/third-party/telegram/telegram-types'

// Production transport for bot updates (dev uses the polling worker; both
// feed handleTelegramUpdate). Registered via setWebhook with a secret_token;
// Telegram echoes it in this header on every delivery, so a matching header
// is proof the call came from Telegram.
// https://core.telegram.org/bots/api#setwebhook
export const telegramWebhookRouter = (deps: TelegramBotDependencies) => {
  return (req: Request, res: Response) => {
    const secretToken = req.headers['x-telegram-bot-api-secret-token']
    if (!secretToken || secretToken !== getConfig().telegramWebhookSecret) {
      logMessage('Invalid or missing Telegram webhook secret token header')
      res.status(401).send()
      return
    }

    // Ack immediately: Telegram redelivers on non-2xx and slow responses, and
    // an import attempt can hold an LLM call for seconds. handleTelegramUpdate
    // never throws, and the import is content-hash idempotent, so a redelivery
    // that does slip through is harmless.
    res.status(200).send()
    void handleTelegramUpdate(req.body as TelegramUpdate, deps)
  }
}
