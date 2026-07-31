import posthog from 'posthog-js'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'

const capture = (eventName: string, properties: Record<string, string | number | boolean> = {}) => {
  if (!isPostHogEnabled()) return
  posthog.capture(eventName, properties)
}

// Curated custom events only: generic clicks and page/overlay views are
// already covered by PostHog's $autocapture and $pageview.
// Use snake_case names, past-tense verbs (modal_opened, not modal_open):
// https://posthog.com/docs/getting-started/send-events#naming-your-custom-events
export const POSTHOG_EVENTS = {
  magicLinkFailureOrExpiration: () => {
    capture('magic_link_failure_or_expiration')
  },
  noTokenHashProvided: () => {
    capture('no_token_hash_provided')
  },
  showPaywallToUser: () => {
    capture('show_paywall_to_user')
  },
  rateLimitUser: () => {
    capture('rate_limit_user')
  },
  invalidTokenError: () => {
    capture('invalid_token_error')
  },
  // Fired on completeOnboarding success (the moment is_onboarded flips), not on
  // the welcome screen's "Get started" — closing the tab after step 1 still
  // counts as onboarded. `variant` distinguishes the standalone wizard from the
  // extension/Telegram pairing embeds.
  onboardingCompleted: (props: { variant: 'web' | 'extensionPair' | 'telegramPair' }) => {
    capture('onboarding_completed', props)
  },
  // Only genuinely new sessions — the find-or-create "already existed" path
  // doesn't fire. `subtitle_source` is absent for pasted-text sessions.
  sessionCreated: (props: {
    study_session_id: string
    content_type: 'movie' | 'tv' | 'text'
    target_language: string
    subtitle_source?: 'opensubtitles' | 'upload'
  }) => {
    capture('session_created', props)
  },
  // The reader's main Save lane (highlight + enrichment + card). The note-only
  // lane deliberately doesn't count: it creates a stub with no study facets.
  vocabularyTermSaved: (props: { target_language: string }) => {
    capture('vocabulary_term_saved', props)
  },
  // Reaching the completion screen of a practice session with at least one
  // item. `composed` is the main queue (correct_count doesn't apply: flashcard
  // ratings aren't binary); `rehab`/`warmup` are the dedicated exercise-only
  // sessions.
  practiceSessionCompleted: (props: {
    session_type: 'composed' | 'rehab' | 'warmup'
    target_language: string
    total_count: number
    correct_count?: number
    hard_count?: number
    is_daily_mix?: boolean
  }) => {
    capture('practice_session_completed', props)
  },
  // The zero-SRS post-reading recap quiz (client-side, no FSRS writes).
  sessionRecapCompleted: (props: { target_language: string; correct_count: number; total_count: number }) => {
    capture('session_recap_completed', props)
  },
  practiceExplainerDismissed: () => {
    capture('practice_explainer_dismissed')
  },
  // The paywall's explicit "Maybe later" — backdrop/escape dismissals don't
  // count as a deliberate decline.
  paywallDismissed: () => {
    capture('paywall_dismissed')
  },
  // Captured before posthog.reset() so it still carries the identified user.
  signOut: () => {
    capture('sign_out')
  },
  // Top of the guest → account conversion funnel: the guest hit the
  // per-guest source cap and was shown the create-account prompt.
  guestSourceLimitReached: () => {
    capture('guest_source_limit_reached')
  },
  // Guest → account conversion funnel: the confirmation email went out…
  guestConversionEmailSent: () => {
    capture('guest_conversion_email_sent')
  },
  // …and the anonymous account became a permanent one (same user id).
  guestConvertedToAccount: (method: 'email' | 'google') => {
    capture('guest_converted_to_account', { method })
  },
}
