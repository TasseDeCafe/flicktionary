import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  SaveFlicktionaryWordMessage,
  SaveFlicktionaryWordResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Upgrades a note-only stub into a full study card — the same
// `highlights.saveWord` write the web gloss sheet uses: persists the chosen
// study intent and runs the normal enrichment (the stub's card fills in place,
// so the note and its seeded chat survive).
export default class SaveFlicktionaryWordHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'save-flicktionary-word'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: SaveFlicktionaryWordResponse) => void
  ) {
    const message = command.message as SaveFlicktionaryWordMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        await client.highlights.saveWord({
          sessionId: message.sessionId,
          highlightId: message.highlightId,
          studyIntent: message.studyIntent,
        })
        sendResponse({ success: true })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'save-flicktionary-word failed')
        sendResponse({ success: false, error: errorMessage })
      }
    })()

    return true
  }
}
