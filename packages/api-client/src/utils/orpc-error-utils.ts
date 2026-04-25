import { ORPCError } from '@orpc/contract'
import { getBackendErrorCodeFromData, getBackendErrorMessageFromData } from './backend-error-utils'

const NON_RETRYABLE_ORPC_STATUS_CODES = new Set([401, 403, 404, 429])
const EXPECTED_VALIDATION_ERROR_CODES = new Set(['AUDIO_VALIDATION_ERROR'])

export const queryRetryHandler = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ORPCError) {
    if (NON_RETRYABLE_ORPC_STATUS_CODES.has(error.status)) {
      return false
    }
  }

  return failureCount < 2
}

export const isExpectedValidationError = (error: unknown): boolean => {
  if (!(error instanceof ORPCError)) return false
  return EXPECTED_VALIDATION_ERROR_CODES.has(error.code)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getBackendErrorCode = (error: ORPCError<any, unknown>): string | undefined => {
  if (error.status < 400 || error.status >= 500) {
    return undefined
  }

  return getBackendErrorCodeFromData(error.data)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getBackendErrorMessage = (error: ORPCError<any, unknown>): string | undefined => {
  return getBackendErrorMessageFromData(error.data)
}
