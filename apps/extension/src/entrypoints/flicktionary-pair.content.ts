// Restricted to the broker URL only — NOT injected globally. The pair page
// posts a single message containing the magic-link token_hash and we forward
// it to the background, which performs the Supabase verifyOtp exchange.

import { getPendingFlicktionaryPairNonce } from '@/services/flicktionary/pairing-nonce-storage'

const POST_MESSAGE_SOURCE = 'flicktionary-extension-pair'
const ACK_SOURCE = 'flicktionary-extension-pair-ack'

interface PairMessageData {
  source: string
  tokenHash: string
  email: string
  nonce: string
}

const isPairMessage = (data: unknown): data is PairMessageData => {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.source === POST_MESSAGE_SOURCE &&
    typeof d.tokenHash === 'string' &&
    typeof d.email === 'string' &&
    typeof d.nonce === 'string'
  )
}

const isPairResponse = (value: unknown): value is { ok: boolean; error?: string } => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.ok === 'boolean' && (v.error === undefined || typeof v.error === 'string')
}

export default defineContentScript({
  matches: [
    'https://app.flicktionary.app/extension-pair*',
    // Content-script match patterns count as host permissions in Chrome Web
    // Store review, so dev hosts are compiled out of prd builds (the define
    // mirrors the host_permissions gate in wxt.config.ts).
    ...(__FLICKTIONARY_DEV_HOSTS__
      ? [
          // dev-tunnel cloudflare hosts (e.g. https://web-sebastien.flicktionary.dev)
          'https://*.flicktionary.dev/extension-pair*',
          // Chrome match patterns can't include a port (it throws "Hostname cannot
          // include a port"); a portless localhost host matches every port, covering
          // both the web dev server (5174) and vite preview (4173).
          'http://localhost/extension-pair*',
        ]
      : []),
  ],
  // document_start, NOT document_idle: the pair page mints the session and
  // posts its one-shot message within a few hundred ms of booting, often
  // before document_idle fires — a listener registered at idle loses that
  // race and the page sits on "Pairing..." until its 10s timeout. At
  // document_start the listener is registered before any page script runs,
  // so the message can never be missed.
  runAt: 'document_start',

  main() {
    window.addEventListener('message', async (event) => {
      if (event.source !== window) return
      if (event.origin !== window.location.origin) return
      if (!isPairMessage(event.data)) return

      try {
        const pending = await getPendingFlicktionaryPairNonce()
        if (!pending || pending.nonce !== event.data.nonce) {
          // Stale tab or expired nonce (2min TTL): surface it instead of
          // leaving the page hanging until its timeout.
          window.postMessage(
            {
              source: ACK_SOURCE,
              nonce: event.data.nonce,
              ok: false,
              error: 'Pairing expired or was started elsewhere. Try again from the extension.',
            },
            window.location.origin
          )
          return
        }

        const response = await browser.runtime.sendMessage({
          sender: 'flicktionary-extension-pair-content',
          message: {
            command: 'flicktionary-pair',
            tokenHash: event.data.tokenHash,
            email: event.data.email,
            nonce: event.data.nonce,
          },
        })

        if (!isPairResponse(response) || !response.ok) {
          window.postMessage(
            {
              source: ACK_SOURCE,
              nonce: event.data.nonce,
              ok: false,
              error: isPairResponse(response) ? response.error : 'Pairing failed',
            },
            window.location.origin
          )
          return
        }

        // Echo back to the broker page so it knows pairing succeeded.
        window.postMessage({ source: ACK_SOURCE, nonce: event.data.nonce, ok: true }, window.location.origin)
      } catch {
        // Background error already logged in handler; page falls back
        // to its 10s timeout state and prompts user to retry.
      }
    })
  },
})
