import type { Browser } from 'wxt/browser'
import type {
  Command,
  FlicktionaryUnmarkKnownMessage,
  FlicktionaryUnmarkKnownResponse,
  Message,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Sweep-exact undo for the declaration sheet: removes only the known-word
// marks stamped with this press's batch id, never earlier sweeps'.
export default class UnmarkKnownHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-unmark-known'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryUnmarkKnownResponse) => void
  ) {
    const message = command.message as FlicktionaryUnmarkKnownMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        const { data } = await client.studySessions.unmarkKnownBySession({
          sessionId: message.sessionId,
          sweepBatchId: message.sweepBatchId,
        })
        sendResponse({ success: true, removedCount: data.removedCount })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'flicktionary-unmark-known failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
