import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { PracticePool } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// The landing's two summary queries — the drifting due summary and the
// session-plan preview — are ONE invalidation unit: anything that can change
// practice state must refresh both, or the plan card keeps promising a
// session the compose no longer produces. Every mutation that used to
// invalidate dueSummary alone (here and in vocabulary / review / lesson-import
// hooks) spreads this instead.
export const practiceSummaryKeys = () => [
  orpcQuery.practice.dueSummary.key(),
  orpcQuery.practice.previewPracticeQueue.key(),
]

// The session-difficulty stat reads FSRS retrievability + vocabulary
// membership + known marks, so EVERY mutation that changes what the user
// knows (ratings and their undos, facet lifecycle, vocabulary add/remove,
// known-mark writes) must spread this — a hand-maintained per-writer list
// would drift. The mark-known preview rides along: it derives from the same
// state (profile minus studied minus known). The whole-language coverage
// read rides along too — its studied/known/verified inputs change on exactly
// the same writes. So does the per-day activity/streak read: introductions,
// ratings and known marks are precisely its day-count sources.
export const difficultyInvalidates = () => [
  orpcQuery.studySessions.getDifficulties.key(),
  orpcQuery.studySessions.getMarkKnownPreview.key(),
  orpcQuery.coverage.getCoverage.key(),
  orpcQuery.stats.getActivity.key(),
]

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

export type PracticeQueuePreview = NonNullable<ReturnType<typeof usePreviewPracticeQueue>['data']>

// What pressing the primary Practice button will serve, in the in-session
// chips' own buckets — the server runs the same plan composition materializes.
// Point-in-time; compose remains the source of truth at press.
export const usePreviewPracticeQueue = (targetLanguage: string | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.practice.previewPracticeQueue.queryOptions({
      input: { targetLanguage: targetLanguage ?? '' },
      enabled: targetLanguage != null,
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load session preview` },
    })
  )
}

// Session-plan previews for a set of languages at once (the Daily Mix banner).
// Same query options — and therefore the same cache entries — as the
// single-language hook, so the banner's numbers equal the practice landing's
// by construction. useQueries keeps the hook count fixed while the language
// list varies. Errors surface in the banner itself, never as toasts.
export const usePreviewPracticeQueues = (targetLanguages: string[]) => {
  return useQueries({
    queries: targetLanguages.map((targetLanguage) =>
      orpcQuery.practice.previewPracticeQueue.queryOptions({
        input: { targetLanguage },
        select: (response) => response.data,
        meta: { showErrorToast: false },
      })
    ),
  })
}

// Single-term rating. Invalidates the landing's drifting counts
// (shared SRS budget). The composed queue itself is a one-shot snapshot held in
// local state, so it is never refetched mid-session.
export const useRateTerm = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.rateTerm.mutationOptions({
      meta: {
        invalidates: [...practiceSummaryKeys(), ...difficultyInvalidates()],
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
        invalidates: [...practiceSummaryKeys(), ...difficultyInvalidates()],
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
        invalidates: [...practiceSummaryKeys(), ...difficultyInvalidates()],
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

// Compose the unified Practice queue. It may warm exercise banks, but does not
// change SRS state; planned introductions are committed only when reached.
export const useComposePracticeQueue = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.composePracticeQueue.mutationOptions({
      meta: { errorMessage: t`Failed to load practice queue` },
    })
  )
}

export const useClaimPracticeIntroduction = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.claimPracticeIntroduction.mutationOptions({
      meta: {
        invalidates: [...practiceSummaryKeys(), ...difficultyInvalidates()],
        errorMessage: t`Failed to start this exercise`,
      },
    })
  )
}

// Read-only re-fetch of the composed plan, polled while exercise placeholders
// generate. A failed poll is silent (the placeholder stays until next tick).
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
        invalidates: [...practiceSummaryKeys(), ...difficultyInvalidates(), orpcQuery.practice.getHintExercise.key()],
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
        invalidates: [...practiceSummaryKeys(), ...difficultyInvalidates()],
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

// The word-family line for a flashcard's back: the deterministic relatives,
// plus the LLM insight only when it is already cached (the endpoint never
// generates it). Fetched as soon as the card shows, so the line is there by
// the time it's revealed. Best-effort: a failure just leaves the line out.
export const useCardWordFamily = (params: { headword: string; targetLanguage: string; pos: string | null } | null) =>
  useQuery(
    orpcQuery.glosses.wordFamily.queryOptions({
      input: params ?? { headword: '', targetLanguage: '', pos: null },
      enabled: params !== null,
      select: (response) => response.data.wordFamily,
      // Anchors follow the user's vocabulary, which changes slowly mid-session.
      staleTime: 10 * 60_000,
      retry: false,
      meta: { showErrorToast: false },
    })
  )
