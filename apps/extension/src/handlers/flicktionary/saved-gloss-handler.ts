import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  FlicktionarySavedGlossMessage,
  FlicktionarySavedGlossResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// Gloss for an EXISTING highlight (the saved-mode popover): wraps
// `highlights.fastGloss`, which serves/refreshes the row's persisted gloss —
// unlike the stateless hover-preview pass behind 'flicktionary-gloss'.
export default class FlicktionarySavedGlossHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-saved-gloss'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionarySavedGlossResponse) => void
  ) {
    const message = command.message as FlicktionarySavedGlossMessage

    void (async () => {
      try {
        const client = getFlicktionaryApiClient()
        const { data } = await client.highlights.fastGloss({
          sessionId: message.sessionId,
          highlightId: message.highlightId,
        })
        sendResponse({ gloss: data.gloss, pos: data.pos, register: data.register, ipa: data.ipa })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'flicktionary-saved-gloss failed')
        sendResponse({ error: errorMessage })
      }
    })()

    return true
  }
}
