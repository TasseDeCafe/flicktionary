import { Command, Message } from '@asbplayer-fork/common'

// Closes the pairing tab once the broker content script reports success. The
// pairing tab is opened with `browser.tabs.create`, so the web page can't close
// itself (`window.close()` only works on script-opened windows), and the delay
// before closing is owned by the content script — a service-worker `setTimeout`
// is unreliable because the worker can be suspended once the pair message
// settles. The content script (which lives in the page and is never suspended)
// times the delay, then sends this command; we just remove the sender's tab.
export default class CloseFlicktionaryPairingTabHandler {
  get sender(): string {
    return 'flicktionary-extension-pair-content'
  }

  get command(): string {
    return 'flicktionary-close-pairing-tab'
  }

  handle(_command: Command<Message>, sender: Browser.runtime.MessageSender): undefined {
    const pairingTabId = sender.tab?.id
    if (pairingTabId !== undefined) {
      void browser.tabs.remove(pairingTabId)
    }
    return undefined
  }
}
