import { defineContentScript } from '#imports'
// `import type` only — the error code is a pure string-literal union, so nothing
// runtime (and none of the ~120KB Lingui catalog) leaks into this always-injected
// content bundle. The background localizes these codes.
import type { ArticleExtractionResult } from '@/services/flicktionary/import-text'
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

// Build readable, paragraph-segmented plain text from Readability's sanitized
// HTML: one line per block element so the backend's line-based parser yields one
// segment per paragraph (rather than one giant blob). Falls back to the flat
// textContent if block extraction comes up empty.
const extractArticle = async (): Promise<ArticleExtractionResult> => {
  try {
    const { Readability } = await import('@mozilla/readability')
    // Readability mutates the document it parses, so always hand it a clone.
    const documentClone = document.cloneNode(true) as Document
    const article = new Readability(documentClone).parse()

    const flatText = article?.textContent?.trim() ?? ''
    if (!article || flatText.length === 0) {
      return { ok: false, errorCode: 'no-readable-article' }
    }

    let text = flatText
    if (article.content) {
      const container = document.createElement('div')
      container.innerHTML = article.content
      const blocks = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre')
      const lines = Array.from(blocks)
        .map((block) => block.textContent?.trim() ?? '')
        .filter((line) => line.length > 0)
      if (lines.length > 0) {
        text = lines.join('\n')
      }
    }

    const title = (article.title || document.title || 'Imported article').trim()
    return { ok: true, title, text }
  } catch {
    return { ok: false, errorCode: 'extract-failed' }
  }
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
