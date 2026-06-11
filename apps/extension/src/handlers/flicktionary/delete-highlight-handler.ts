import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  DeleteFlicktionaryHighlightMessage,
  DeleteFlicktionaryHighlightResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Removes one saved highlight from the overlay's saved-mode popover. A 404
// (already deleted from the web app / another tab) counts as success — the
// user's intent ("this highlight should not exist") is satisfied either way.
export default class DeleteFlicktionaryHighlightHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'delete-flicktionary-highlight'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: DeleteFlicktionaryHighlightResponse) => void
  ) {
    const message = command.message as DeleteFlicktionaryHighlightMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        await client.highlights.delete({ sessionId: message.sessionId, highlightId: message.highlightId })
        sendResponse({ success: true })
      } catch (error) {
        if ((error as { status?: number } | undefined)?.status === 404) {
          sendResponse({ success: true })
          return
        }
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'delete-flicktionary-highlight failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
