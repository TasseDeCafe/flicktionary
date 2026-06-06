import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { queryRetryHandler } from '@flicktionary/api-client/utils/orpc-error-utils'
import { toast } from 'sonner'
import { msg } from '@lingui/core/macro'
import { i18n } from '../lingui'
import { extractFlicktionaryApiError } from '@/services/flicktionary/api-error'

// Augment React Query's meta types for this realm (same pattern as
// apps/web/src/types/hook-types.ts, trimmed to what the extension uses).
declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      showErrorToast?: boolean
      errorMessage?: string
    }
    mutationMeta: {
      showErrorToast?: boolean
      errorMessage?: string
    }
  }
}

interface ErrorMeta {
  showErrorToast?: boolean
  errorMessage?: string
}

// Meta-driven error toast — the simplified mirror of apps/web's
// react-query-config (no Sentry/PostHog/paywall/error-overlay machinery in the
// extension). Components with their own inline error displays opt out via
// `meta: { showErrorToast: false }`; everything else falls back to a toast,
// preferring the structured backend message when one is present.
const handleApiError = (error: unknown, meta?: ErrorMeta) => {
  if (!(meta?.showErrorToast ?? true)) {
    return
  }

  const fallbackMessage = meta?.errorMessage ?? i18n._(msg`Something went wrong.`)
  toast.error(extractFlicktionaryApiError(error, fallbackMessage).message)
}

// One QueryClient per page realm (popup and options are separate documents).
//
// Retry: queryRetryHandler's `instanceof ORPCError` check works against
// OpenAPILink-thrown errors here — @orpc/contract re-exports the class from
// @orpc/client and the workspace resolves a single @orpc/client instance, so
// 4xx responses are correctly not retried.
export const makeExtensionQueryClient = (): QueryClient =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        console.warn(`Query ${JSON.stringify(query.queryKey)} failed`, error)
        handleApiError(error, query.meta)
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        console.warn(`Mutation ${JSON.stringify(mutation.options.mutationKey)} failed`, error)
        handleApiError(error, mutation.meta)
      },
    }),
    defaultOptions: {
      queries: {
        retry: queryRetryHandler,
        // The popup/options documents fully remount on every open — there is
        // no window-focus refetch scenario worth paying for.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  })
