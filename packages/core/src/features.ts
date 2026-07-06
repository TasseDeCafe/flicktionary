export const FEATURES: Record<
  'SENTRY' | 'POSTHOG' | 'STRIPE' | 'REVENUECAT' | 'GOOGLE_AUTH' | 'APPLE_AUTH' | 'TELEGRAM',
  boolean
> = {
  SENTRY: false,
  POSTHOG: false,
  STRIPE: true,
  REVENUECAT: true,
  GOOGLE_AUTH: true,
  APPLE_AUTH: false,
  TELEGRAM: true,
}
