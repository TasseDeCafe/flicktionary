import { logCustomErrorMessageAndError } from '../../../transport/error-monitoring/error-monitoring'
import { handleTelegramUpdate, TelegramBotDependencies } from '../../telegram-bot/handle-telegram-update'

export interface TelegramPollingWorkerInterface {
  initialize: () => void
  stop: () => void
}

const ERROR_BACKOFF_MS = 5_000
const LONG_POLL_TIMEOUT_SECONDS = 30

// Dev transport for bot updates: getUpdates long polling against a dev bot.
// Production uses the webhook instead — Telegram rejects getUpdates while a
// webhook is registered, which is also why initialize() clears any stale
// webhook before polling. Both transports feed handleTelegramUpdate.
export const TelegramPollingWorker = (deps: TelegramBotDependencies): TelegramPollingWorkerInterface => {
  let started = false
  let stopped = false

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const loop = async (): Promise<void> => {
    let offset: number | null = null
    while (!stopped) {
      try {
        const updates = await deps.telegramApi.getUpdates({
          offset,
          timeoutSeconds: LONG_POLL_TIMEOUT_SECONDS,
        })
        for (const update of updates) {
          offset = update.update_id + 1
          // handleTelegramUpdate never throws; a poison update can't wedge the loop.
          await handleTelegramUpdate(update, deps)
        }
      } catch (error) {
        logCustomErrorMessageAndError('Telegram polling loop error', error)
        await sleep(ERROR_BACKOFF_MS)
      }
    }
  }

  return {
    initialize: (): void => {
      if (started) return
      started = true
      void (async () => {
        try {
          await deps.telegramApi.deleteWebhook()
        } catch (error) {
          logCustomErrorMessageAndError('Telegram deleteWebhook failed on polling start', error)
        }
        console.log('Telegram polling worker started')
        await loop()
      })()
    },
    stop: (): void => {
      stopped = true
    },
  }
}

// No-op default so buildApp (used by mock/test runs) never long-polls the
// Telegram API — mirrors MockEnrichmentWorker. The real worker is constructed
// in server.ts (non-production only) and injected into buildApp.
export const MockTelegramPollingWorker = (): TelegramPollingWorkerInterface => {
  return {
    initialize: (): void => {
      // No-op.
    },
    stop: (): void => {
      // No-op.
    },
  }
}
