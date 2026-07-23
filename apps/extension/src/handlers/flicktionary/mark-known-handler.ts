import type { Browser } from 'wxt/browser'
import type {
  Command,
  FlicktionaryMarkKnownMessage,
  FlicktionaryMarkKnownResponse,
  Message,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// The declaration sheet's sweep step: mark everything watched up to the run's
// frontier as known (`known_lemmas` rows only — no SRS side effects; saved
// terms are skipped server-side).
export default class MarkKnownHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-mark-known'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryMarkKnownResponse) => void
  ) {
    const message = command.message as FlicktionaryMarkKnownMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        const { data } = await client.studySessions.markRemainingKnown({
          sessionId: message.sessionId,
          toSegmentIndex: message.toSegmentIndex,
        })
        sendResponse({ success: true, markedCount: data.markedCount, sweepBatchId: data.sweepBatchId })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'flicktionary-mark-known failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
