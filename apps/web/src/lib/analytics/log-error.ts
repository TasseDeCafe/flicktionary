import posthog from 'posthog-js'
import { getConfig } from '@/config/environment-config.ts'
import { ORPCError } from '@orpc/contract'
import { buildOrpcErrorContext } from '@flicktionary/api-client/utils/backend-error-utils'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'

type Stringifiable = string | number | boolean | null | undefined | { toString(): string }

export type LogSeverity = 'error' | 'warning' | 'info' | 'debug'

// Provider-neutral handled-error logging: console locally, PostHog error
// tracking in deployed environments. Non-Error values are wrapped in a
// synthetic Error so they still show up as an issue with a stack trace.
export const logError = ({
  message,
  error,
  params = {},
  severity = 'error',
}: {
  message: string
  error?: unknown
  params?: Record<string, Stringifiable>
  severity?: LogSeverity
}) => {
  if (getConfig().shouldLogLocally) {
    const logMethod = severity === 'error' ? console.error : severity === 'warning' ? console.warn : console.info

    logMethod(`${message} -- params: ${JSON.stringify(params)}`, error)
  }

  if (!isPostHogEnabled()) return

  const properties: Record<string, unknown> = {
    log_message: message,
    severity,
    ...params,
  }

  if (error instanceof ORPCError) {
    properties.orpc = buildOrpcErrorContext(error)
  } else if (error !== undefined && !(error instanceof Error)) {
    properties.raw_error = JSON.stringify(error)
  }

  posthog.captureException(error instanceof Error ? error : new Error(message), properties)
}
