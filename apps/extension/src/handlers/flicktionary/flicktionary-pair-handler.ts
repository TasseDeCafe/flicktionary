import { Command, Message } from '@asbplayer-fork/common'
import {
  getFlicktionarySupabase,
  persistSupabaseSession,
} from '../../services/flicktionary/flicktionary-supabase-client'
import {
  clearPendingFlicktionaryPairNonce,
  getPendingFlicktionaryPairNonce,
} from '../../services/flicktionary/pairing-nonce-storage'
import { reconcileUiPrefsOnPairing } from '../../services/flicktionary/ui-prefs-sync'

interface FlicktionaryPairMessage extends Message {
  command: 'flicktionary-pair'
  tokenHash: string
  email: string
  nonce: string
}

// The pairing tab is opened with `browser.tabs.create`, so the web page can't
// close itself (`window.close()` only works on script-opened windows). We close
// it from here after a short delay so the user sees the success copy first. 1.5s
// is well inside the MV3 service-worker idle timeout (~30s), so the timer fires
// before the worker can be suspended.
const PAIRING_TAB_CLOSE_DELAY_MS = 1500

const isPairMessage = (msg: unknown): msg is FlicktionaryPairMessage => {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return (
    m.command === 'flicktionary-pair' &&
    typeof m.tokenHash === 'string' &&
    typeof m.email === 'string' &&
    typeof m.nonce === 'string'
  )
}

// Background-side handler for the pair message forwarded by the broker content
// script. Performs Supabase `verifyOtp({ token_hash, type: 'magiclink' })` and
// persists the resulting session via `auth-storage.ts`.
//
// Returns `true` from `handle` to keep `sendResponse` async-callable, per
// asbplayer's existing CommandHandler contract.
export default class FlicktionaryPairHandler {
  get sender(): string {
    return 'flicktionary-extension-pair-content'
  }

  get command(): string {
    return 'flicktionary-pair'
  }

  handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
    const msg = command.message
    if (!isPairMessage(msg)) {
      sendResponse({ ok: false, error: 'Invalid pair payload' })
      return false
    }

    void (async () => {
      const pending = await getPendingFlicktionaryPairNonce()
      if (!pending || pending.nonce !== msg.nonce) {
        sendResponse({ ok: false, error: 'Pairing nonce was not started by this extension' })
        return
      }

      try {
        const { data, error } = await getFlicktionarySupabase().auth.verifyOtp({
          token_hash: msg.tokenHash,
          type: 'magiclink',
        })

        if (error || !data?.session || !data.user) {
          sendResponse({ ok: false, error: error?.message ?? 'verifyOtp returned no session' })
          return
        }

        await persistSupabaseSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at ?? undefined,
          user: { id: data.user.id, email: data.user.email ?? msg.email },
        })
        // Pairing happens via the web page → this background handler while the
        // popup is typically closed, so the UI-prefs reconcile lives here (NOT
        // in the popup's auth-change listener). Fire-and-forget: pairing
        // success must not depend on the prefs round-trip.
        void reconcileUiPrefsOnPairing()
        sendResponse({ ok: true })

        // Close the pairing tab the extension opened, leaving the success copy
        // up briefly. `start-pairing.ts` set `openerTabId`, so the browser
        // re-focuses the tab the user paired from.
        const pairingTabId = sender.tab?.id
        if (pairingTabId !== undefined) {
          setTimeout(() => {
            void browser.tabs.remove(pairingTabId)
          }, PAIRING_TAB_CLOSE_DELAY_MS)
        }
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Pairing failed' })
      } finally {
        await clearPendingFlicktionaryPairNonce()
      }
    })()

    return true
  }
}
