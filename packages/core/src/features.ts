export const FEATURES: Record<
  'SENTRY' | 'POSTHOG' | 'STRIPE' | 'REVENUECAT' | 'GOOGLE_AUTH' | 'APPLE_AUTH' | 'TELEGRAM',
  boolean
> = {
  // SENTRY only affects the native app: web and backend use PostHog
  SENTRY: false,
  POSTHOG: true,
  STRIPE: true,
  REVENUECAT: true,
  GOOGLE_AUTH: true,
  APPLE_AUTH: false,
  TELEGRAM: true,
}
