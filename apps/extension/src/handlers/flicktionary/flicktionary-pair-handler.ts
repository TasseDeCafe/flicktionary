import { Command, Message } from '@asbplayer-fork/common'
import {
  getFlicktionarySupabase,
  persistSupabaseSession,
} from '../../services/flicktionary/flicktionary-supabase-client'
import {
  clearPendingFlicktionaryPairNonce,
  getPendingFlicktionaryPairNonce,
  setFlicktionaryPairedTabId,
} from '../../services/flicktionary/pairing-nonce-storage'
import { reconcileUiPrefsOnPairing } from '../../services/flicktionary/ui-prefs-sync'
import { clearFlicktionarySessionCache } from '../../services/flicktionary/youtube-session-cache'

interface FlicktionaryPairMessage extends Message {
  command: 'flicktionary-pair'
  tokenHash: string
  email: string
  nonce: string
}

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

  handle(command: Command<Message>, sender: Browser.runtime.MessageSender, sendResponse: (response?: unknown) => void) {
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
          isGuest: false,
        })
        // The session cache is keyed by video content, not by account — cached
        // session/segment ids from the previous identity (a guest, or another
        // paired account) must not leak into the new account's save path.
        await clearFlicktionarySessionCache()
        // Pairing happens via the web page → this background handler while the
        // popup is typically closed, so the UI-prefs reconcile lives here (NOT
        // in the popup's auth-change listener). Fire-and-forget: pairing
        // success must not depend on the prefs round-trip.
        void reconcileUiPrefsOnPairing()

        // The pairing tab is opened with `browser.tabs.create`, so the page
        // can't `window.close()` itself — the extension closes it. We no longer
        // close it on a timer here: the page now decides when pairing is *done*
        // (immediately when already onboarded, or after web onboarding) and
        // posts `flicktionary-pair-finished`. Record the paired tab id so that
        // handler can validate it only ever closes this exact tab.
        const pairingTabId = sender.tab?.id
        if (pairingTabId !== undefined) {
          await setFlicktionaryPairedTabId(pairingTabId)
        }
        sendResponse({ ok: true })
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Pairing failed' })
      } finally {
        await clearPendingFlicktionaryPairNonce()
      }
    })()

    return true
  }
}
