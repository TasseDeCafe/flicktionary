import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import {
  ERROR_CODE_FOR_INVALID_TOKEN,
  ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED,
} from '@template-app/api-client/key-generation/frontend-api-key-constants'
import { buildOrpcErrorContext } from '@template-app/api-client/utils/backend-error-utils'
import {
  getBackendErrorCode,
  getBackendErrorMessage,
  isExpectedValidationError,
  queryRetryHandler,
} from '@template-app/api-client/utils/orpc-error-utils'
import { toast } from 'sonner'
import { QueryMeta } from '@/types/hook-types'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { Route as pricingRoute } from '@/app/routes/_authenticated/pricing/index'
import { USER_FACING_ERROR_CODE } from '@template-app/core/constants/user-facing-error-code'
import { OverlayId } from '@/components/ui/overlay-ids'
import { ORPCError } from '@orpc/contract'
import { i18n } from '@/lib/i18n/i18n'
import { msg, t } from '@lingui/core/macro'

const handleGenericApiError = (meta?: QueryMeta) => {
  const showErrorToast = meta?.showErrorToast ?? true
  // by default, we don't show the intrusive error overlay
  // to show it, explicitly pass showErrorModal = true in the hook
  const showErrorModal = meta?.showErrorModal ?? false
  const errorMessage = meta?.errorMessage ?? i18n._(msg`Something went wrong.`)

  if (showErrorModal) {
    useOverlayStore.getState().openErrorOverlay(USER_FACING_ERROR_CODE.GENERIC_ERROR)
  } else if (showErrorToast) {
    toast.error(errorMessage, {
      description: i18n._(msg`Please try again or refresh the page.`),
      action: {
        label: i18n._(msg`Refresh`),
        onClick: () => window.location.reload(),
      },
    })
  }
}

const handleApiError = (error: unknown, meta?: QueryMeta) => {
  const showErrorModal = meta?.showErrorModal ?? true

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
      if (typeof window !== 'undefined') {
        window.location.assign(pricingRoute.to)
      }
      return
    }

    handleGenericApiError(meta)
    return
  }

  if (error.code === 'TOO_MANY_REQUESTS') {
    POSTHOG_EVENTS.rateLimitUser()
    if (showErrorModal) {
      useOverlayStore.getState().openOverlay(OverlayId.RATE_LIMITING)
    }
    return
  }

  if (error.code === 'UNAUTHORIZED') {
    if (backendErrorCode === ERROR_CODE_FOR_INVALID_TOKEN) {
      POSTHOG_EVENTS.invalidTokenError()
      if (showErrorModal) {
        useOverlayStore.getState().openErrorOverlay(USER_FACING_ERROR_CODE.INVALID_TOKEN_ERROR)
      }
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

      logWithSentry({
        message: `QueryKey ${JSON.stringify(query.queryKey)} failed`,
        error,
        params: {
          queryKey: JSON.stringify(query.queryKey),
          meta,
          orpc: error instanceof ORPCError ? buildOrpcErrorContext(error) : undefined,
        },
      })

      handleApiError(error, meta)
    },
  }),
  mutationCache: new MutationCache({
    onMutate: (_variables, mutation) => {
      const meta = mutation.meta

      const showSuccessToast = meta?.showSuccessToast ?? false
      const successMessage = meta?.successMessage ?? i18n._(t`Success!`)

      if (showSuccessToast) {
        toast.success(successMessage)
      }
    },
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.meta

      handleApiError(error, meta)

      if (!isExpectedValidationError(error)) {
        logWithSentry({
          message: `MutationKey ${JSON.stringify(mutation.options.mutationKey)} failed`,
          error,
          params: {
            mutationKey: JSON.stringify(mutation.options.mutationKey),
            meta,
            orpc: error instanceof ORPCError ? buildOrpcErrorContext(error) : undefined,
          },
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
