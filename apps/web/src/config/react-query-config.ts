import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import {
  ERROR_CODE_FOR_GUEST_ACCESS_DISABLED,
  ERROR_CODE_FOR_INVALID_TOKEN,
  ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED,
} from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import { buildOrpcErrorContext } from '@flicktionary/api-client/utils/backend-error-utils'
import {
  getBackendErrorCode,
  getBackendErrorMessage,
  isExpectedValidationError,
  queryRetryHandler,
} from '@flicktionary/api-client/utils/orpc-error-utils'
import { toast } from 'sonner'
import { QueryMeta } from '@/types/hook-types'
import { logError } from '@/lib/analytics/log-error'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { Route as pricingRoute } from '@/app/routes/_authenticated/pricing/index'
import { Route as loginRoute } from '@/app/routes/login/index'
import { useAuthStore } from '@/stores/auth-store'
import { USER_FACING_ERROR_CODE } from '@flicktionary/core/constants/user-facing-error-code'
import { OverlayId } from '@flicktionary/ui/components/overlay-ids'
import { ORPCError } from '@orpc/contract'
import { i18n } from '@/lib/i18n/i18n'
import { msg, t } from '@lingui/core/macro'

// An administrative lock-out (guest kill switch flipped off), not an error:
// handleApiError signs the guest out silently, so it must not reach Sentry or
// PostHog exception tracking either.
const isGuestAccessDisabledError = (error: unknown) =>
  error instanceof ORPCError && getBackendErrorCode(error) === ERROR_CODE_FOR_GUEST_ACCESS_DISABLED

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
    // Upstream limits (TMDB / OpenSubtitles throttling the backend) are not the
    // user's doing — a specific toast beats the "slow down" rate-limit overlay.
    if (backendErrorCode === 'UPSTREAM_QUOTA_EXCEEDED') {
      toast.error(i18n._(msg`Subtitle downloads are limited for today. Please try again tomorrow.`))
      return
    }
    if (backendErrorCode === 'UPSTREAM_RATE_LIMITED') {
      toast.error(i18n._(msg`An external service is busy right now. Please try again in a moment.`))
      return
    }
    POSTHOG_EVENTS.rateLimitUser()
    if (showErrorModal) {
      useOverlayStore.getState().openOverlay(OverlayId.RATE_LIMITING)
    }
    return
  }

  if (error.code === 'UNAUTHORIZED') {
    if (backendErrorCode === ERROR_CODE_FOR_GUEST_ACCESS_DISABLED) {
      // The guest kill switch was flipped off while this guest session was
      // live. That's an administrative lock-out, not an error state: silently
      // clear the session and land on /login. Parallel queries all fail with
      // this code at once, so guard against re-entrant sign-outs.
      const { isSigningOut, signOut } = useAuthStore.getState()
      if (!isSigningOut && typeof window !== 'undefined') {
        void signOut(() => window.location.assign(loginRoute.to))
      }
      return
    }

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

      if (!isGuestAccessDisabledError(error)) {
        logError({
          message: `QueryKey ${JSON.stringify(query.queryKey)} failed`,
          error,
          params: {
            queryKey: JSON.stringify(query.queryKey),
            meta,
            orpc: error instanceof ORPCError ? buildOrpcErrorContext(error) : undefined,
          },
        })
      }

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

      if (!isExpectedValidationError(error) && !isGuestAccessDisabledError(error)) {
        logError({
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
    // Declarative invalidation: hooks list the query keys a mutation affects in
    // meta.invalidates instead of hand-rolling onSuccess/onSettled callbacks.
    // Runs on settle (success AND error): a failed mutation may have partially
    // landed, and optimistically-applied UI (theme, locale) self-heals from the
    // refetched server value. This cache-level callback fires after the
    // mutation-level onError, so optimistic rollbacks land before the refetch.
    onSettled: (_data, _error, _variables, _context, mutation) => {
      const invalidates = mutation.meta?.invalidates
      if (!invalidates) return
      for (const queryKey of invalidates) {
        // Fire-and-forget: returning the promise would keep the mutation
        // pending (and block mutateAsync) until the refetch completes.
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: queryRetryHandler,
    },
  },
})
