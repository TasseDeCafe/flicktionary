import type { BackendErrorDetails, BackendErrorResponse } from '../orpc-contracts/common/error-response-schema'

export type OrpcErrorLike = {
  data?: unknown
  toJSON: () => Record<string, unknown>
}

const getBackendErrorResponse = (data: unknown): BackendErrorResponse | undefined => {
  if (!data || typeof data !== 'object') {
    return undefined
  }

  const backendResponse = data as BackendErrorResponse
  if (!Array.isArray(backendResponse.errors)) {
    return undefined
  }

  return {
    errors: backendResponse.errors.filter((error): error is BackendErrorDetails =>
      Boolean(error && typeof error === 'object')
    ),
  }
}

export const getBackendErrorsFromData = (data: unknown): BackendErrorDetails[] => {
  return getBackendErrorResponse(data)?.errors ?? []
}

export const getBackendErrorCodeFromData = (data: unknown): string | undefined => {
  return getBackendErrorsFromData(data).find((error) => typeof error.code === 'string')?.code
}

// For mutation onError / promise catch handlers, whose error is typed unknown:
// the backend's machine-readable code (e.g. 'CONTENT_BLOCKED', 'cefr_not_set'),
// or '' when the failure carries none.
export const getBackendErrorCodeFromError = (error: unknown): string =>
  getBackendErrorCodeFromData((error as { data?: unknown } | null | undefined)?.data) ?? ''

export const getBackendErrorMessageFromData = (data: unknown): string | undefined => {
  return getBackendErrorsFromData(data).find((error) => typeof error.message === 'string')?.message
}

export const buildOrpcErrorContext = (error: OrpcErrorLike) => {
  const backendErrors = getBackendErrorsFromData(error.data)
  const backendErrorMessages = backendErrors
    .map((backendError) => backendError.message)
    .filter((message): message is string => Boolean(message))
  const backendErrorCodes = backendErrors
    .map((backendError) => backendError.code)
    .filter((code): code is string => Boolean(code))

  return {
    ...error.toJSON(),
    backendErrors,
    backendErrorCodes,
    backendErrorMessages,
    backendErrorSummary: backendErrorMessages.length > 0 ? backendErrorMessages.join(' | ') : undefined,
  }
}
