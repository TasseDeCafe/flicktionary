import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  FlicktionaryWordFamilyInsightMessage,
  FlicktionaryWordFamilyInsightResponse,
} from '@asbplayer-fork/common'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'

// The word-family line with its LLM insight, via `glosses.wordFamilyInsight`.
// The overlay only asks once a popover is pinned or a saved word is opened —
// the first request for a word runs an LLM call server-side.
export default class FlicktionaryWordFamilyInsightHandler {
  get sender(): string[] {
    return ['asbplayer-video-tab']
  }

  get command(): string {
    return 'flicktionary-word-family-insight'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: FlicktionaryWordFamilyInsightResponse) => void
  ) {
    const message = command.message as FlicktionaryWordFamilyInsightMessage

    void (async () => {
      try {
        const { data } = await getFlicktionaryApiClient().glosses.wordFamilyInsight({
          selectionText: message.selectionText,
          targetLanguage: message.targetLanguage,
          pos: message.pos,
        })
        sendResponse({ wordFamily: data.wordFamily })
      } catch (error) {
        const { message: errorMessage } = extractFlicktionaryApiError(error, 'flicktionary-word-family-insight failed')
        sendResponse({ error: errorMessage })
      }
    })()

    return true
  }
}
