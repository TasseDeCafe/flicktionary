import type { Browser } from 'wxt/browser'
import type {
  Command,
  FlicktionaryAssertKnownBacklogMessage,
  FlicktionaryAssertKnownBacklogResponse,
  Message,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// The declaration sheet's "saved but never practiced" step: seed the checked
// words straight into review state (docs/SRS.md §6c). Ids the server no
// longer accepts are skipped there, so the asserted count can be lower than
// the selection.
export default class AssertKnownBacklogHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-assert-known-backlog'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryAssertKnownBacklogResponse) => void
  ) {
    const message = command.message as FlicktionaryAssertKnownBacklogMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        const { data } = await client.studySessions.assertKnownBacklog({
          sessionId: message.sessionId,
          checkpointId: message.checkpointId,
          userLookupIds: message.userLookupIds,
        })
        sendResponse({ success: true, assertedCount: data.asserted })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'flicktionary-assert-known-backlog failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
