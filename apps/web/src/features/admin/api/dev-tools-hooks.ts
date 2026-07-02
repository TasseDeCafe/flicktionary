import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { useLingui } from '@lingui/react/macro'

export const useAdvancePracticeClockMutation = () => {
  const { t } = useLingui()

  return useMutation(
    orpcQuery.devTools.advancePracticeClock.mutationOptions({
      meta: {
        // The shift touches everything practice-adjacent: due summaries, the
        // composed queue, vocabulary due-sort, and term study targets.
        invalidates: [orpcQuery.practice.key(), orpcQuery.chunks.key()],
        errorMessage: t`Failed to advance the practice clock`,
      },
    })
  )
}
