import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { PracticePool } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { dropTermFromComposedSession } from '../components/composed-session-snapshot'

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

// Single-term rating. Invalidates the landing's drifting counts
// (shared SRS budget). The composed queue itself is a one-shot snapshot held in
// local state, so it is never refetched mid-session.
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

// Start an exercise-first warm-up for a session's new terms. Parks them into
// scaffolding (consuming the daily new-term budget) and serves gate exercises,
// so the landing's due/new counts and the review queue shift — invalidate them.
export const useStartWarmupSession = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.startWarmupSession.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to start warm-up`,
      },
    })
  )
}

// Serve-only re-fetch of a warm-up session, polled while exercises generate in
// the background. No parking / no introductions, so nothing to invalidate; a
// failed poll is silent (the placeholder just stays until the next tick).
export const useRefreshWarmupSession = () => {
  return useMutation(
    orpcQuery.practice.refreshWarmupSession.mutationOptions({
      meta: { showErrorToast: false },
    })
  )
}

// Compose the unified Practice queue (gate exercises + due flashcards). A
// mutation: with autoWarmup on it parks eligible new terms into warm-up
// (consuming the daily new-term budget), so the landing counts shift.
export const useComposePracticeQueue = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.composePracticeQueue.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to load practice queue`,
      },
    })
  )
}

// Serve-only re-fetch of the composed queue, polled while exercise
// placeholders generate. The server forces auto-warm-up off, so nothing to
// invalidate; a failed poll is silent (the placeholder stays until next tick).
export const useRefreshPracticeQueue = () => {
  return useMutation(
    orpcQuery.practice.refreshPracticeQueue.mutationOptions({
      meta: { showErrorToast: false },
    })
  )
}

// Grade one exercise answer. Invalidates the landing counts — a correct gate
// answer can advance rehab (and graduation changes parked/due counts) — and
// every hint-exercise query: answering consumes the exercise, so a cached
// hint serve would submit against a dead exerciseId.
export const useSubmitExerciseAnswer = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.submitExerciseAnswer.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key(), orpcQuery.practice.getHintExercise.key()],
        errorMessage: t`Failed to submit answer`,
      },
    })
  )
}

// Exit ramp for a failed exercise placeholder: unpark the term (soft
// re-entry, due immediately) so it's served as a normal flashcard instead of
// an unservable gate. Invalidates the landing counts — parked becomes due.
export const useStudyParkedTermAsFlashcard = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.studyParkedTermAsFlashcard.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to move the term to flashcards`,
      },
    })
  )
}

// One ready hint exercise for the flashcard currently shown (bank-first; the
// server may kick a background generation on a miss but never blocks on it).
// Availability is best-effort: a null exercise or a failed check just hides
// the Hint button, so no error toast.
export const useHintExercise = (params: { userLookupId: string; pool: PracticePool } | null) => {
  return useQuery(
    orpcQuery.practice.getHintExercise.queryOptions({
      input: params ?? { userLookupId: '', pool: 'recognition' },
      enabled: params != null,
      select: (response) => response.data.exercise,
      meta: { showErrorToast: false },
    })
  )
}

// Bootstrap or resume the current reading text for a (language, pool).
// Invalidates the landing summary: this is the call that flips a text to
// 'reading', and the landing's "continue reading" affordance reads off that.
export const useGenerateNextReadingText = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.generateNextReadingText.mutationOptions({
      meta: {
        invalidates: [orpcQuery.practice.dueSummary.key()],
        errorMessage: t`Failed to generate next text`,
      },
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
      // An interrupted composed session stashed for resume must not re-serve
      // the deleted term's cards/exercises.
      onSuccess: (_data, { id }) => dropTermFromComposedSession(id),
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
