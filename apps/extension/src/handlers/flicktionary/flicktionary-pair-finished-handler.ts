import { Command, Message } from '@asbplayer-fork/common'
import {
  clearFlicktionaryPairedTabId,
  getFlicktionaryPairedTabId,
} from '../../services/flicktionary/pairing-nonce-storage'

// Sent by the pairing page (via the pair content script) once pairing is *done*
// — immediately when the account is already onboarded, or after the user
// completes web onboarding in the pairing tab. Replaces the old 1.5s auto-close
// timer in the pair handler.
//
// Trust/idempotence: this handler ONLY ever closes `sender.tab.id` — never any
// other tab id. The recorded paired-tab id is used purely as a guard: if it is
// present and does NOT match the sender, we refuse (a stray message from some
// other tab can't close the pairing tab). If the recorded id was lost to an MV3
// worker suspend, we still close `sender.tab.id` — the pairing content script is
// URL-gated to app.flicktionary.app/extension-pair*, and the message only ever
// closes its own sender tab, so this is a safe UX fallback.
export default class FlicktionaryPairFinishedHandler {
  get sender(): string {
    return 'flicktionary-extension-pair-content'
  }

  get command(): string {
    return 'flicktionary-pair-finished'
  }

  handle(_command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
    void (async () => {
      const senderTabId = sender.tab?.id
      if (senderTabId === undefined) {
        sendResponse({ ok: false, error: 'No sender tab to close' })
        return
      }

      const recorded = await getFlicktionaryPairedTabId()
      if (recorded !== null && recorded !== senderTabId) {
        // A message from a tab that isn't the one we paired. Never close it.
        sendResponse({ ok: false, error: 'Sender is not the paired tab' })
        return
      }

      await clearFlicktionaryPairedTabId()
      sendResponse({ ok: true })
      try {
        await browser.tabs.remove(senderTabId)
      } catch {
        // The tab may already be gone (user closed it manually); nothing to do.
      }
    })()

    return true
  }
}
