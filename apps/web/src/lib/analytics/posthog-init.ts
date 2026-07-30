import posthog from 'posthog-js'
import type { CaptureResult, Properties } from 'posthog-js'
import { FEATURES } from '@flicktionary/core/features'
import { getConfig } from '@/config/environment-config'

// Query params that are safe to keep on URLs captured by PostHog. Everything
// else is stripped before an event leaves the browser — most importantly the
// Supabase `token_hash` on magic-link verification URLs and the self-signing
// Telegram `auth` tokens, which must never reach a third party.
const ALLOWED_QUERY_PARAMS = new Set([
  'partnerId',
  'c',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
])

const scrubUrl = (value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  for (const key of [...url.searchParams.keys()]) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) {
      url.searchParams.delete(key)
    }
  }
  return url.toString()
}

const isUrlLike = (value: unknown): value is string =>
  typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))

const scrubObjectUrls = (obj: Properties | undefined): void => {
  if (!obj) return
  for (const [key, value] of Object.entries(obj)) {
    if (isUrlLike(value)) {
      obj[key] = scrubUrl(value)
    }
  }
}

const scrubEventUrls = (event: CaptureResult | null): CaptureResult | null => {
  if (!event) return null
  scrubObjectUrls(event.properties)
  scrubObjectUrls(event.properties?.$set as Properties | undefined)
  scrubObjectUrls(event.properties?.$set_once as Properties | undefined)
  scrubObjectUrls(event.$set)
  scrubObjectUrls(event.$set_once)
  return event
}

export const isPostHogEnabled = (): boolean => FEATURES.POSTHOG && Boolean(getConfig().posthogProjectToken)

// An empty token disables PostHog entirely: automated tests and Railway
// PR/ephemeral previews simply don't define VITE_POSTHOG_PROJECT_TOKEN.
export const initPostHog = (): void => {
  if (!FEATURES.POSTHOG) return

  const { posthogProjectToken, shouldLogLocally } = getConfig()
  if (!posthogProjectToken) {
    if (shouldLogLocally) {
      console.error(
        'VITE_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_PROJECT_TOKEN is configured'
      )
    }
    return
  }

  posthog.init(posthogProjectToken, {
    api_host: 'https://eu.i.posthog.com',
    defaults: '2026-06-25',
    persistence: 'localStorage+cookie',
    capture_exceptions: true,
    // Replay privacy is enforced both here and in the PostHog project
    // settings: the app renders user-imported text (subtitles, articles,
    // notes, translations, chat), so everything is masked until specific
    // static UI is deliberately unmasked.
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
    },
    before_send: scrubEventUrls,
  })
}
