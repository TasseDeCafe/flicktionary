export const ROUTE_PATHS = {
  DASHBOARD: '/dashboard',
  PRICING: '/pricing',
  PREMIUM_DEMO: '/premium-demo',

  LOGIN: '/login',
  LOGIN_EMAIL: '/login/email',
  LOGIN_EMAIL_SENT: '/login/email/sent',
  LOGIN_EMAIL_VERIFY: '/login/email/verify',

  ACCOUNT_REMOVED: '/account/removed',
  ADMIN_SETTINGS: '/admin-settings',
  // the ones below do not exist in the web app
  SEE_PLANS: '/choose-plan',
} as const
