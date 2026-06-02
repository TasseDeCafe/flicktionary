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
    _command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: { success: boolean; sessionId?: string; error?: string }) => void
  ) {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (!tab) {
        sendResponse({ success: false, error: 'No active tab to import from.' })
        return
      }
      const outcome = await importArticleFromTab(tab)
      sendResponse(
        outcome.ok ? { success: true, sessionId: outcome.sessionId } : { success: false, error: outcome.error }
      )
    })()

    return true
  }
}
