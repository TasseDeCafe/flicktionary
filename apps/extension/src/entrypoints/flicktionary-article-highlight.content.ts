import { defineContentScript } from '#imports'
// Tiny static surface only: a pure string helper, no React / ui / Readability.
// The orchestrator (which pulls all of that) is dynamically imported on the
// first toggle, so every page the user visits pays only this listener's cost.
import { articleActiveFlagKey } from '@/services/article-highlight/constants'

// Content script for the on-page article-highlight surface (Readwise-style).
// Always injected in the top frame; inert until the user activates highlighting
// from the toolbar popup or the page context menu.

const HIGHLIGHT_SENDER = 'flicktionary-extension-highlight'
const TOGGLE_COMMAND = 'toggle-article-highlighting'

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  runAt: 'document_idle',

  main() {
    let controller: { destroy(): void } | null = null
    let activating = false

    const activate = async (): Promise<void> => {
      if (controller || activating) return
      activating = true
      try {
        const { startArticleHighlighting } = await import('@/ui/article-highlight/start')
        // onClosed fires when the user closes via the banner (× / Switch); drop
        // our reference so the next toggle re-activates on the first press.
        const started = await startArticleHighlighting({
          onClosed: () => {
            controller = null
          },
        })
        // A toggle-off could have landed while the dynamic import / settings
        // read was in flight — honor it by tearing the fresh controller down.
        if (activating) controller = started
        else started.destroy()
      } finally {
        activating = false
      }
    }

    const deactivate = (): void => {
      activating = false
      controller?.destroy()
      controller = null
    }

    const toggle = (): void => {
      if (controller) deactivate()
      else void activate()
    }

    browser.runtime.onMessage.addListener((request: unknown) => {
      const envelope = request as { sender?: string; message?: { command?: string } }
      if (envelope?.sender !== HIGHLIGHT_SENDER) {
        return false
      }
      if (envelope.message?.command === TOGGLE_COMMAND) {
        toggle()
      }
      return false
    })

    // Auto-reactivate after a reload if highlighting was on for this URL (the
    // server-backed paint is re-fetched on activate). sessionStorage clears on
    // tab close, so this never resurrects on a brand-new tab.
    try {
      if (sessionStorage.getItem(articleActiveFlagKey(location.href)) === '1') {
        void activate()
      }
    } catch {
      // sessionStorage unavailable (sandboxed frame) — skip auto-reactivation.
    }
  },
})
