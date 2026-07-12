import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation } from '@tanstack/react-query'
import { practiceSummaryKeys } from '@/features/practice/api/practice-hooks'

// Mutation for the "Add a word" flow. Invalidates everything that depends on
// the user's vocabulary set: chunks list (Vocabulary tab), language list
// (the language pills), and the practice due summary (the saved term's facets
// land Unseen — `srs_state IS NULL` — and feed the up-next pool; introduction
// and the daily budget happen later). Mirrors the invalidation set used by
// useDeleteChunk in vocabulary-hooks.ts.
//
// `showErrorToast: false` suppresses the global toast — callers differentiate
// between `cefr_not_set` (open the CEFR dialog inline, no toast),
// `native_language_not_set` (its own toast), and unknown failures (a generic
// toast). Letting the global handler fire would double up on cefr_not_set
// with the raw backend code as the toast text.
export const useCreateAdhocCard = () => {
  return useMutation(
    orpcQuery.cards.createAdhoc.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.chunks.listChunks.key(),
          orpcQuery.chunks.listLanguages.key(),
          ...practiceSummaryKeys(),
        ],
        showErrorToast: false,
      },
    })
  )
}
