import { defineContentScript } from '#imports'
// `extractArticle` dynamically import()s Readability internally, so statically
// importing it here keeps Readability out of this always-injected static bundle.
import { extractArticle } from '@/services/flicktionary/extract-article'
import { MAX_Z_INDEX } from '@/constants'

// Content script for the Flicktionary text-import flow. Runs in the top frame of
// every page so the background can, on demand:
//   * extract the main article text via Mozilla Readability (the engine behind
//     Firefox Reader View) — stripping nav/ads/related-widgets that make manual
//     copy-paste painful; and
//   * surface a small status toast (errors mostly — the success path opens the
//     reader in a new tab, which is feedback enough).
//
// Readability is dynamically imported so its ~30KB only loads when the user
// actually triggers an import, keeping this always-injected script tiny.

const IMPORT_SENDER = 'flicktionary-extension-import'
const EXTRACT_COMMAND = 'flicktionary-extract-article'
const TOAST_COMMAND = 'flicktionary-import-toast'

interface ToastPayload {
  kind: 'success' | 'error'
  message: string
}

const showToast = (payload: ToastPayload): void => {
  const el = document.createElement('div')
  el.textContent = payload.message
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: String(MAX_Z_INDEX),
    bottom: '20px',
    right: '20px',
    maxWidth: '320px',
    padding: '12px 16px',
    borderRadius: '8px',
    font: '14px/1.4 system-ui, -apple-system, sans-serif',
    color: '#ffffff',
    background: payload.kind === 'success' ? '#16a34a' : '#dc2626',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  runAt: 'document_idle',

  main() {
    browser.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
      const envelope = request as { sender?: string; message?: { command?: string; payload?: ToastPayload } }
      if (envelope?.sender !== IMPORT_SENDER) {
        return false
      }

      if (envelope.message?.command === EXTRACT_COMMAND) {
        void extractArticle().then(sendResponse)
        return true
      }

      if (envelope.message?.command === TOAST_COMMAND && envelope.message.payload) {
        showToast(envelope.message.payload)
        return false
      }

      return false
    })
  },
})
