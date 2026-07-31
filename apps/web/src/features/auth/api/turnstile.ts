// Invisible Cloudflare Turnstile for anonymous sign-in (issue #391). The
// widget type (invisible) is a property of the sitekey configured in the
// Cloudflare dashboard, so this module just renders and harvests the token.
// Every failure resolves to a reason instead of throwing: the caller treats
// any failure as "no guest session" and falls back to the /login redirect.

export type TurnstileResult = { token: string } | { failure: 'script_blocked' | 'challenge_failed' | 'timeout' }

// Invisible mode has no interactive fallback: visitors Turnstile can't
// passively clear simply never produce a token, so the timeout doubles as the
// cap on how long a legitimate slow network can delay the guest landing.
const CHALLENGE_TIMEOUT_MS = 10_000

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (
    container: HTMLElement,
    params: {
      sitekey: string
      callback: (token: string) => void
      'error-callback': () => boolean
    }
  ) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

// Memoized: the script is injected once per page load, and only when captcha
// is actually enabled — visitors of a captcha-off deployment never contact
// Cloudflare at all.
let scriptLoadPromise: Promise<boolean> | null = null

const loadTurnstileScript = (): Promise<boolean> => {
  if (window.turnstile) return Promise.resolve(true)
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise<boolean>((resolve) => {
      const script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.onload = () => resolve(true)
      // Blocked script (adblocker, offline): allow a later retry to re-inject
      // rather than caching the failure for the page's lifetime.
      script.onerror = () => {
        scriptLoadPromise = null
        resolve(false)
      }
      document.head.appendChild(script)
    })
  }
  return scriptLoadPromise
}

export const getCaptchaToken = async (siteKey: string): Promise<TurnstileResult> => {
  const scriptLoaded = await loadTurnstileScript()
  if (!scriptLoaded || !window.turnstile) {
    return { failure: 'script_blocked' }
  }
  const turnstile = window.turnstile

  // Invisible widgets render nothing, but Turnstile still needs a container
  // element in the document.
  const container = document.createElement('div')
  document.body.appendChild(container)

  let widgetId: string | null = null
  const cleanup = () => {
    if (widgetId !== null) {
      try {
        turnstile.remove(widgetId)
      } catch {
        // Removing an already-removed widget throws; the container removal
        // below is what actually matters.
      }
    }
    container.remove()
  }

  try {
    const result = await new Promise<TurnstileResult>((resolve) => {
      const timeoutId = setTimeout(() => resolve({ failure: 'timeout' }), CHALLENGE_TIMEOUT_MS)
      try {
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          callback: (token: string) => {
            clearTimeout(timeoutId)
            resolve({ token })
          },
          'error-callback': () => {
            clearTimeout(timeoutId)
            resolve({ failure: 'challenge_failed' })
            // Tell Turnstile the error is handled so it doesn't log to the
            // console or retry on its own.
            return true
          },
        })
      } catch {
        clearTimeout(timeoutId)
        resolve({ failure: 'challenge_failed' })
      }
    })
    return result
  } finally {
    cleanup()
  }
}
