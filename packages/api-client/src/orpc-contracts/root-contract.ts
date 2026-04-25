import { authenticationContract } from './authentication-contract'
import { billingContract } from './billing-contract'
import { userContract } from './user-contract'
import { contactEmailContract } from './contact-email-contract'
import { checkoutContract } from './checkout-contract'
import { portalSessionContract } from './portal-session-contract'
import { removalsContract } from './removals-contract'
import { healthCheckContract } from './health-check-contract'
import { sentryDebugContract } from './sentry-debug-contract'
import { configContract } from './config-contract'

export const rootOrpcContract = {
  authentication: authenticationContract,
  billing: billingContract,
  user: userContract,
  contactEmail: contactEmailContract,
  checkout: checkoutContract,
  portalSession: portalSessionContract,
  removals: removalsContract,
  healthCheck: healthCheckContract,
  sentryDebug: sentryDebugContract,
  config: configContract,
} as const
