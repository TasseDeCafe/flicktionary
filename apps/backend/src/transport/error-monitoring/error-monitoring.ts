import axios, { AxiosError } from 'axios'
import { isPosthogEnabled, posthogClient } from '../third-party/posthog/posthog-client'
import { _sanitizeEmails } from './sanitize-utils'
import { getRequestContextUserId } from '../../context/request-context'

const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError
    if (err.response) {
      return `Axios error: response status: ${err.response.status}. Error response data: ${JSON.stringify(err.response.data)}`
    } else if (err.request) {
      return 'Axios error: No response received'
    } else {
      return `Axios error: Error message: ${JSON.stringify(err.message)})`
    }
  } else {
    return `error: ${error}, errorAsJson: ${JSON.stringify(error)}`
  }
}

const getMessageAndErrorAsString = (customErrorMessage: string, error: unknown): string => {
  return `${customErrorMessage} -- ${getErrorMessage(error)}`
}

const getCurrentFunctionName = () => {
  const stack = new Error().stack
  // Get the caller's name from stack trace (4th line, as 1st is Error, 2nd is getCurrentFunctionName, 3rd is logError)
  const callerLine = stack?.split('\n')[3] ?? ''
  // Extract function name - matches anything between "at " and " (" and removes "Object."
  const match = callerLine.match(/at (?:Object\.)?([^ (]+)/)
  return match?.[1] ?? 'unknown_function'
}

type Stringifiable = string | number | boolean | null | undefined | { toString(): string }

const __buildMessageWithFunctionName = ({
  functionName,
  message,
  params = {},
  error,
}: {
  functionName: string
  message: string
  params?: Record<string, Stringifiable>
  error?: unknown
}) => {
  const paramsEntries = Object.entries(params)
  const paramsString = paramsEntries.map(([key, value]) => `${key} - ${JSON.stringify(value)}`).join(', ')

  let fullMessage = `${functionName}: ${message}`

  if (paramsEntries.length > 0) {
    fullMessage += `, ${paramsString}`
  }

  if (error) {
    fullMessage += ` -- ${getErrorMessage(error)}`
  }
  return fullMessage
}

const captureError = ({
  message,
  error,
  properties,
}: {
  message: string
  error?: unknown
  properties: Record<string | number, unknown>
}) => {
  if (!isPosthogEnabled()) return

  const userId = getRequestContextUserId()
  // Non-Error values are wrapped in a synthetic Error so they still surface
  // as an error-tracking issue with a stack trace.
  posthogClient.captureException(error instanceof Error ? error : new Error(message), userId ?? undefined, properties)
}

// Provider-neutral handled-error logging: console (pm2 logs, local debugging)
// plus PostHog error tracking. Info-level messages are console-only.
export const logMessage = (message: string, isInfoLevel: boolean = false) => {
  const logMethod = isInfoLevel ? console.info : console.error
  logMethod(message)
  if (isInfoLevel) return
  const sanitizedMessage = _sanitizeEmails(message)
  captureError({ message: sanitizedMessage, properties: { log_message: sanitizedMessage } })
}

export const logCustomErrorMessageAndError = (customErrorMessage: string, error: unknown) => {
  const result = getMessageAndErrorAsString(customErrorMessage, error)
  console.error(result)
  const sanitizedMessage = _sanitizeEmails(result)
  captureError({ message: sanitizedMessage, error, properties: { log_message: sanitizedMessage } })
}

export const logError = ({
  message,
  params = {},
  error,
}: {
  message: string
  params?: Record<string, Stringifiable>
  error?: unknown
}) => {
  const functionName = getCurrentFunctionName()
  const fullMessage: string = __buildMessageWithFunctionName({ functionName, message, params, error })

  console.error(fullMessage)

  const sanitizedMessage = _sanitizeEmails(fullMessage)

  const properties: Record<string | number, unknown> = {
    log_message: sanitizedMessage,
    function_name: functionName,
    ...params,
  }
  if (error !== undefined && !(error instanceof Error)) {
    properties.raw_error = JSON.stringify(error)
  }

  captureError({ message: sanitizedMessage, error, properties })
}
