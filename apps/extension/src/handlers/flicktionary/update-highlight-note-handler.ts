import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  UpdateFlicktionaryHighlightNoteMessage,
  UpdateFlicktionaryHighlightNoteResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Persists the saved-mode popover's note + preset tags on a highlight — the
// same `highlights.updateNoteAndTags` write the web gloss sheet uses, including
// the frontend-composed chatSeedPrompt that seeds the card chat.
export default class UpdateFlicktionaryHighlightNoteHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'update-flicktionary-highlight-note'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: UpdateFlicktionaryHighlightNoteResponse) => void
  ) {
    const message = command.message as UpdateFlicktionaryHighlightNoteMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        await client.highlights.updateNoteAndTags({
          sessionId: message.sessionId,
          highlightId: message.highlightId,
          note: message.note,
          presetTags: [...message.presetTags],
          chatSeedPrompt: message.chatSeedPrompt,
        })
        sendResponse({ success: true })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(
          error,
          'update-flicktionary-highlight-note failed'
        )
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
