import * as Sentry from '@sentry/react'

export const identifyUserWithSentry = (userId: string) => {
  Sentry.setUser({ id: userId })
}

export const clearSentryUser = () => {
  Sentry.setUser(null)
}
