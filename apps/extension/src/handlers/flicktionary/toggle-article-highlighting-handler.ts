import type { Browser } from 'wxt/browser'
import type { Command, Message } from '@asbplayer-fork/common'

// Popup "Highlight on this page" button. The popup can't message a content
// script directly, so it routes through the background (sender
// 'asbplayer-popup'), which forwards the toggle to the active tab's
// article-highlight content script (sender 'flicktionary-extension-highlight').
export default class ToggleArticleHighlightingHandler {
  get sender() {
    return 'asbplayer-popup'
  }

  get command() {
    return 'flicktionary-toggle-highlighting'
  }

  handle(
    _command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: { success: boolean; error?: string }) => void
  ) {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (tab?.id === undefined) {
        sendResponse({ success: false, error: 'No active tab.' })
        return
      }
      try {
        await browser.tabs.sendMessage(tab.id, {
          sender: 'flicktionary-extension-highlight',
          message: { command: 'toggle-article-highlighting' },
        })
        sendResponse({ success: true })
      } catch {
        // The content script isn't reachable (restricted page, or loaded before
        // the extension installed/updated).
        sendResponse({ success: false, error: 'Reload the page, then try again.' })
      }
    })()

    return true
  }
}
