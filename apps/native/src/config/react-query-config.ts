import { MutationCache, Query, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner-native'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import {
  ERROR_CODE_FOR_INVALID_TOKEN,
  ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED,
} from '@template-app/api-client/key-generation/frontend-api-key-constants'
import { ORPCError } from '@orpc/contract'
import { buildOrpcErrorContext } from '@template-app/api-client/utils/backend-error-utils'
import {
  getBackendErrorCode,
  getBackendErrorMessage,
  isExpectedValidationError,
  queryRetryHandler,
} from '@template-app/api-client/utils/orpc-error-utils'
import RevenueCatUI from 'react-native-purchases-ui'
import { QueryMeta } from '@/types/hook-types'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { i18n } from '@/lib/i18n/i18n'
import { msg } from '@lingui/core/macro'

const handleGenericApiError = (meta?: QueryMeta) => {
  const showErrorToast = meta?.showErrorToast ?? true
  const errorMessage = meta?.errorMessage ?? i18n._(msg`Something went wrong`)

  if (showErrorToast) {
    toast.error(errorMessage)
  }
}

const handleApiError = (error: unknown, meta?: QueryMeta, queryKey?: readonly unknown[]) => {
  if (!(error instanceof ORPCError)) {
    handleGenericApiError(meta)
    return
  }

  const backendErrorCode = getBackendErrorCode(error)

  if (error.code === 'NOT_FOUND') {
    return
  }

  if (error.code === 'FORBIDDEN') {
    if (backendErrorCode === ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED) {
      POSTHOG_EVENTS.showPaywallToUser()
      RevenueCatUI.presentPaywall({ displayCloseButton: false })
        .catch((paywallError) => {
          logWithSentry('Paywall presentation/dismiss error', paywallError)
        })
        .finally(() => {
          // IMPORTANT: Always invalidate queries after the paywall attempt.
          // If the user subscribed, queries will succeed.
          // If they dismissed without subscribing, queries will likely hit 403 again,
          // re-triggering this onError handler and showing the paywall again.
          if (queryKey) {
            queryClient.invalidateQueries({ queryKey })
          }
        })

      return
    }

    handleGenericApiError(meta)
    return
  }

  if (error.code === 'TOO_MANY_REQUESTS') {
    POSTHOG_EVENTS.rateLimitUser()
    const errorMessage = meta?.errorMessage ?? i18n._(msg`Too many requests. Please try again later.`)
    toast.error(errorMessage)
    return
  }

  if (error.code === 'UNAUTHORIZED') {
    if (backendErrorCode === ERROR_CODE_FOR_INVALID_TOKEN) {
      POSTHOG_EVENTS.invalidTokenError()
      const errorMessage = meta?.errorMessage ?? i18n._(msg`Invalid token. Please sign in again.`)
      toast.error(errorMessage)
      return
    }

    handleGenericApiError(meta)
    return
  }

  const backendErrorMessage = getBackendErrorMessage(error)
  if (backendErrorMessage && (meta?.showErrorToast ?? true)) {
    toast.error(backendErrorMessage)
    return
  }

  handleGenericApiError(meta)
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const meta = query.meta

      logWithSentry(`QueryKey: ${JSON.stringify(query.queryKey)}`, error, {
        queryKey: JSON.stringify(query.queryKey),
        meta,
        orpc: error instanceof ORPCError ? buildOrpcErrorContext(error) : undefined,
      })

      handleApiError(error, meta, query.queryKey)
    },
  }),
  mutationCache: new MutationCache({
    onMutate: (_variables, mutation) => {
      const meta = mutation.meta

      const showSuccessToast = meta?.showSuccessToast ?? false
      const successMessage = meta?.successMessage ?? i18n._(msg`Success!`)

      if (showSuccessToast) {
        toast.success(successMessage)
      }
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const meta = mutation.meta

      const shouldSkipInvalidation = Array.isArray(meta?.invalidates) && meta.invalidates.length === 0

      // https://tkdodo.eu/blog/automatic-query-invalidation-after-mutations
      if (!shouldSkipInvalidation) {
        queryClient
          .invalidateQueries({
            predicate: (query: Query) => {
              const queryMeta = query.meta
              return queryMeta?.skipGlobalInvalidation !== true
            },
          })
          .then()
      }
    },
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.meta

      handleApiError(error, meta)

      if (!isExpectedValidationError(error)) {
        logWithSentry(`MutationKey: ${JSON.stringify(mutation.options.mutationKey)}`, error, {
          mutationKey: JSON.stringify(mutation.options?.mutationKey),
          meta,
          orpc: error instanceof ORPCError ? buildOrpcErrorContext(error) : undefined,
        })
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: queryRetryHandler,
    },
  },
})
