import type { Browser } from 'wxt/browser'
import type {
  Command,
  Message,
  SaveArticleHighlightMessage,
  SaveArticleHighlightResponse,
} from '@asbplayer-fork/common'
import { msg } from '@lingui/core/macro'
import { getFlicktionaryAuth } from '../../services/flicktionary/auth-storage'
import { getFlicktionaryApiClient } from '../../services/flicktionary/flicktionary-api-client'
import { extractFlicktionaryApiError } from '../../services/flicktionary/api-error'
import { activateBackgroundLocale } from '../../services/activate-background-locale'
import { i18n } from '../../ui/lingui'

// Saves an on-page article selection as a Flicktionary highlight (sender
// 'flicktionary-extension-highlight'). The content script already resolved the
// live selection to a single segment id + char offsets, so this is a thin
// highlights.create wrapper — single-segment (start === end). Mirrors
// save-word-handler's create call without the video context.
export default class SaveArticleHighlightHandler {
  get sender() {
    return 'flicktionary-extension-highlight'
  }

  get command() {
    return 'save-article-highlight'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (r?: SaveArticleHighlightResponse) => void
  ) {
    const message = command.message as SaveArticleHighlightMessage

    void (async () => {
      try {
        await activateBackgroundLocale()
        const auth = await getFlicktionaryAuth()
        if (!auth) {
          sendResponse({ success: false, error: i18n._(msg`Sign in to Flicktionary to save words.`) })
          return
        }

        const { data: created } = await getFlicktionaryApiClient().highlights.create({
          sessionId: message.sessionId,
          startSegmentId: message.segmentId,
          endSegmentId: message.segmentId,
          startOffset: message.startOffset,
          endOffset: message.endOffset,
          selectionText: message.selectionText,
          studyIntent: message.studyIntent,
        })

        sendResponse({ success: true, id: created.id, fastGloss: created.fastGloss })
      } catch (error) {
        const { code, message: errorMessage } = extractFlicktionaryApiError(error, 'Failed to save to Flicktionary')
        sendResponse({ success: false, code, error: errorMessage })
      }
    })()

    return true
  }
}
