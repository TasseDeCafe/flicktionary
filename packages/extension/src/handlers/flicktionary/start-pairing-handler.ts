import type { Browser } from 'wxt/browser'
import type { Command, Message, FlicktionaryStartPairingResponse } from '@asbplayer-fork/common'
import { openFlicktionaryPairingTab } from '../../services/flicktionary/start-pairing'

// Background-side handler that starts the Flicktionary pairing flow on behalf of
// a surface that can't open a tab itself (the in-video overlay content script).
// Mirrors the popup's "Sign in with Flicktionary" button: mint a nonce and open
// the web pairing tab. The existing FlicktionaryPairHandler completes the flow.
export default class FlicktionaryStartPairingHandler {
  get sender() {
    return ['asbplayer-video-tab', 'asbplayerv2']
  }

  get command() {
    return 'flicktionary-start-pairing'
  }

  handle(
    _command: Command<Message>,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (r?: FlicktionaryStartPairingResponse) => void
  ) {
    void (async () => {
      try {
        await openFlicktionaryPairingTab()
        sendResponse({ success: true })
      } catch (error) {
        console.error('Failed to start Flicktionary pairing', error)
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to start pairing' })
      }
    })()

    return true
  }
}
