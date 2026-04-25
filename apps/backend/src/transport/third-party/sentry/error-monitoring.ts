import axios, { AxiosError } from 'axios'
import * as Sentry from '@sentry/node'
import { FEATURES } from '@template-app/core/features'
import { logMessageWithSentry } from './log-message-with-sentry'
import { _sanitizeEmails } from './sentry-utils'
import { getRequestContextUserId } from '../../../context/request-context'

export type SentryAttachment = {
  filename: string
  data: string | Uint8Array
  contentType?: string
}

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

export const logMessage = (message: string, isInfoLevel: boolean = false) => {
  // the line below is useful when:
  // 1. we browse pm2 logs
  // 2. we debug locally
  const logMethod = isInfoLevel ? console.info : console.error
  logMethod(message)
  logMessageWithSentry(message, isInfoLevel)
}

const getMessageAndErrorAsString = (customErrorMessage: string, error: unknown): string => {
  return `${customErrorMessage} -- ${getErrorMessage(error)}`
}

export const logCustomErrorMessageAndError = (customErrorMessage: string, error: unknown) => {
  const result = getMessageAndErrorAsString(customErrorMessage, error)
  // the line below is useful when:
  // 1. we browse pm2 logs
  // 2. we debug locally
  console.error(result)
  logMessageWithSentry(result)
}

const getCurrentFunctionName = () => {
  const stack = new Error().stack
  // Get the caller's name from stack trace (4th line, as 1st is Error, 2nd is getCurrentFunctionName, 3rd is logFunctionError)
  const callerLine = stack?.split('\n')[3] ?? ''
  // Extract function name - matches anything between "at " and " (" and removes "Object."
  const match = callerLine.match(/at (?:Object\.)?([^ (]+)/)
  return match?.[1] ?? 'unknown_function'
}

type Stringifiable = string | number | boolean | null | undefined | { toString(): string }

export const __buildMessageWithFunctionName = ({
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

export const logWithSentry = ({
  message,
  params = {},
  error,
  isInfoLevel = false,
  attachments,
  tags = {},
  extras,
}: {
  message: string
  params?: Record<string, Stringifiable>
  error?: unknown
  isInfoLevel?: boolean
  attachments?: SentryAttachment | SentryAttachment[]
  tags?: Record<string, string>
  extras?: Record<string, unknown>
}) => {
  const functionName = getCurrentFunctionName()
  const fullMessage: string = __buildMessageWithFunctionName({ functionName, message, params, error })

  const logMethod = isInfoLevel ? console.info : console.error
  logMethod(fullMessage)

  const normalizedAttachments = attachments ? (Array.isArray(attachments) ? attachments : [attachments]) : undefined
  const severityLevel = isInfoLevel ? 'info' : 'error'
  const sanitizedMessage = _sanitizeEmails(fullMessage)
  const normalizedParams = params ?? {}

  if (!FEATURES.SENTRY || !Sentry.isInitialized()) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setLevel(severityLevel)
    scope.setTransactionName(functionName)
    scope.setTag('message', sanitizedMessage)
    scope.setTag('functionName', functionName)
    const userId = getRequestContextUserId()
    if (userId) {
      scope.setUser({ id: userId })
    }

    if (Object.keys(normalizedParams).length > 0) {
      scope.setContext('params', normalizedParams)
    }

    Object.entries(tags).forEach(([key, value]) => {
      scope.setTag(key, value)
    })

    if (extras) {
      Object.entries(extras).forEach(([key, value]) => {
        scope.setExtra(key, value)
      })
    }

    if (normalizedAttachments) {
      normalizedAttachments.forEach((attachment) => {
        scope.addAttachment(attachment)
      })
    }

    if (error instanceof Error) {
      Sentry.captureException(error)
      return
    }

    if (error !== undefined) {
      scope.setExtra('rawError', error)
    }

    Sentry.captureMessage(sanitizedMessage, severityLevel)
  })
}
