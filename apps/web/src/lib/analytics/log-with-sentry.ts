import { getConfig } from '@/config/environment-config.ts'
import * as Sentry from '@sentry/react'
import { FEATURES } from '@template-app/core/features'
import { ORPCError } from '@orpc/contract'
import { buildOrpcErrorContext } from '@template-app/api-client/utils/backend-error-utils'

type Stringifiable = string | number | boolean | null | undefined | { toString(): string }

export const logWithSentry = ({
  message,
  error,
  params = {},
  severityLevel = 'error',
}: {
  message: string
  error?: unknown
  params?: Record<string, Stringifiable>
  severityLevel?: Sentry.SeverityLevel
}) => {
  if (getConfig().shouldLogLocally) {
    const logMethod =
      severityLevel === 'error' || severityLevel === 'fatal'
        ? console.error
        : severityLevel === 'warning'
          ? console.warn
          : console.info

    logMethod(`${message} -- params: ${JSON.stringify(params)}`, error)
  }

  if (FEATURES.SENTRY && Sentry.isInitialized()) {
    Sentry.withScope((scope) => {
      scope.setTransactionName(message)
      scope.setContext('params', params)
      scope.setLevel(severityLevel)
      scope.setTag('message', message)

      if (error instanceof ORPCError) {
        scope.setContext('orpc', buildOrpcErrorContext(error))
        Sentry.captureException(error)
        return
      }

      if (error instanceof Error) {
        Sentry.captureException(error)
        return
      }

      if (error !== undefined) {
        scope.setExtra('rawError', error)
      }

      Sentry.captureMessage(message)
    })
  }
}
