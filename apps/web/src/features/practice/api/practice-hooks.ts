import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { PracticePool, ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const useDueSummary = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.practice.dueSummary.queryOptions({
      input: {},
      select: (response) => response.data.perLanguage,
      meta: { errorMessage: t`Failed to load practice summary` },
    })
  )
}

// Live review pool for the (language, pool, scope). select unwraps the
// { data: { terms } } envelope. The flashcard mode iterates the batch locally;
// remounting refetches a fresh slice (already-rated terms drop out naturally).
// `count` is the explicit learn-new batch size (learn_new scope only) — it's
// part of the orpc input and therefore of the query key, so different batch
// picks never share a cached slice.
//
// gcTime: 0 — the queue is a one-shot client-side slice: the view seeds its
// local queue from the FIRST data it sees and deliberately ignores later
// refetches (mid-session updates must not clobber local state). Serving a
// cached slice on remount therefore replays already-rated cards and pre-edit
// content (e.g. returning from the focus-view editor), and the background
// refetch can't fix it. Dropping the cache on unmount makes every (re)entry
// load fresh.
export const useListReviewTerms = (targetLanguage: string, pool: PracticePool, scope: ReviewScope, count?: number) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.practice.listReviewTerms.queryOptions({
      input: { targetLanguage, pool, scope, ...(count != null ? { newBatchSize: count } : {}) },
      select: (r) => r.data.terms,
      gcTime: 0,
      meta: { errorMessage: t`Failed to load review terms` },
    })
  )
}

// Flashcard-mode single-term rating. Invalidates the landing's drifting counts
// (shared SRS budget). The flashcard queue itself is held in local state, so we
// don't refetch listReviewTerms mid-session.
export const useRateTerm = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.rateTerm.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to record rating`,
      },
    })
  )
}

// Revert a previously applied rating (first half of the peek re-rate flow —
// the caller follows up with a fresh useRateTerm). Takes the eventId the
// rating response returned; a stale handle resolves undone=false (no error).
// Invalidates the landing counts — the undo refunds review/new budget.
export const useUndoRating = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.undoRating.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to undo rating`,
      },
    })
  )
}

// Build a Strengthen session (gate exercises for parked leeches + bonus
// exercises for this-session again/hard terms). POST because the server may
// kick off background generation for cold banks.
export const useStartStrengthenSession = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.startStrengthenSession.mutationOptions({
      meta: { errorMessage: t`Failed to load exercises` },
    })
  )
}

// Grade one exercise answer. Invalidates the landing counts — a correct gate
// answer can advance rehab (and graduation changes parked/due counts).
export const useSubmitExerciseAnswer = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.submitExerciseAnswer.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to submit answer`,
      },
    })
  )
}

// Bootstrap or resume the current reading text for a (language, pool).
export const useGenerateNextReadingText = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.generateNextReadingText.mutationOptions({
      meta: { errorMessage: t`Failed to generate next text` },
    })
  )
}

// Fire-and-forget pre-generation. Eagerly kicks off the LLM call for the next
// slot as soon as the current text loads so advance can hand back a 'ready' row
// instantly. Failures are non-fatal (advance regenerates fresh).
export const usePrepareNextReadingText = () => {
  return useMutation(
    orpcQuery.practice.prepareNextReadingText.mutationOptions({
      meta: { showErrorToast: false },
    })
  )
}

// The single reading-mode mutation: finalize the current text (FSRS for every
// annotation) and surface the next. Invalidates the landing's drifting counts.
export const useAdvanceReadingText = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.advanceReadingText.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to advance`,
      },
    })
  )
}

export const useReadingHistory = (targetLanguage: string, pool: PracticePool) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.practice.readingHistory.queryOptions({
      input: { targetLanguage, pool },
      select: (r) => r.data.texts,
      meta: { errorMessage: t`Failed to load history` },
    })
  )
}

// Soft-delete from inside a practice text. The reading view holds its text in
// local component state (mutation response), so the annotation's deleted state
// is flipped optimistically there; here we only refresh the vocab list and the
// landing counts.
export const useDeleteChunkFromPractice = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.deleteChunk.mutationOptions({
      meta: {
        invalidates: [orpcQuery.chunks.listChunks.key(), orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to delete term`,
      },
    })
  )
}

// Counterpart to useDeleteChunkFromPractice. Clears deleted_at without touching
// count/status — the chunk resumes participating in SRS with its existing schedule.
export const useRestoreChunkFromPractice = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.restoreChunk.mutationOptions({
      meta: {
        invalidates: [orpcQuery.chunks.listChunks.key(), orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to restore term`,
      },
    })
  )
}

// Selection-driven gloss for a span in the practice text. No server-side cache —
// TanStack Query handles re-selection of the same span via its in-memory cache.
export const usePracticeFastGloss = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.fastGloss.mutationOptions({
      meta: { errorMessage: t`Failed to fetch translation` },
    })
  )
}
