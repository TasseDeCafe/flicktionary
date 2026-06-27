import type { Browser } from 'wxt/browser'
import type { Command, Message } from '@asbplayer-fork/common'
import { importArticleFromTab } from '../../services/flicktionary/import-text'

// Popup "Import this article" button. Extracts the active tab's main article via
// Readability (content script) and imports it into Flicktionary, opening the new
// reading session. Responds to the popup so it can surface an inline error when
// the import fails (on success the new tab opening closes the popup anyway).
export default class ImportArticleHandler {
  get sender() {
    return 'asbplayer-popup'
  }

  get command() {
    return 'flicktionary-import-article'
  }

  handle(
    command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: {
      success: boolean
      sessionId?: string
      error?: string
      // The detected language has no CEFR level — the popup hosts an inline
      // picker and replays the import with `isCefrRetry: true`.
      needsCefr?: boolean
      targetLanguage?: string
    }) => void
  ) {
    // The popup widens the import message with the CEFR-retry signal so a replay
    // (after the user picks a level) doesn't loop back into the picker.
    const isCefrRetry = (command.message as { isCefrRetry?: boolean }).isCefrRetry === true
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (!tab) {
        sendResponse({ success: false, error: 'No active tab to import from.' })
        return
      }
      const outcome = await importArticleFromTab(tab, { presentation: 'popup', isCefrRetry })
      if (outcome.ok) {
        sendResponse({ success: true, sessionId: outcome.sessionId })
        return
      }
      if ('kind' in outcome) {
        sendResponse({ success: false, needsCefr: true, targetLanguage: outcome.targetLanguage })
        return
      }
      sendResponse({ success: false, error: outcome.error })
    })()

    return true
  }
}
