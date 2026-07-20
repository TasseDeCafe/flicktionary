import { useMemo } from 'react'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { applyOptimistic, optimisticPatch } from '@/lib/query/optimistic'
import type { Highlight, StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'

// Temp ids for optimistically-inserted highlight rows (the create response
// swaps in the real row). Anything keyed on a highlight id (delete, fastGloss,
// the saved-mode sheet) must skip rows still carrying this prefix — they don't
// exist server-side yet.
export const OPTIMISTIC_HIGHLIGHT_ID_PREFIX = 'optimistic-'
export const isOptimisticHighlightId = (id: string): boolean => id.startsWith(OPTIMISTIC_HIGHLIGHT_ID_PREFIX)

type StudySessionQueryData = {
  data: StudySession
}

const isStudySessionQueryData = (value: unknown): value is StudySessionQueryData => {
  if (typeof value !== 'object' || value === null || !('data' in value)) return false
  const data = value.data
  return typeof data === 'object' && data !== null && 'furthestReadSegmentIndex' in data
}

// Sessions whose reading position was explicitly SET (the manual bookmark)
// since the last throttled advance. While a session is in here the monotonic
// merge below stands down — the set is allowed to move the pointer backwards,
// and raising refetches back up would resurrect the value the user just
// corrected. The next advance write re-arms the guard.
const manualReadingPositionSessionIds = new Set<string>()

const mergeFurthestReadSegmentIndex = (cached: unknown, incoming: unknown): unknown => {
  if (!isStudySessionQueryData(incoming)) return incoming
  if (manualReadingPositionSessionIds.has(incoming.data.id)) return incoming
  const cachedData = isStudySessionQueryData(cached) ? cached : undefined
  const cachedIndex = cachedData?.data.furthestReadSegmentIndex
  const incomingIndex = incoming.data.furthestReadSegmentIndex
  if (cachedIndex == null) return incoming
  const furthestReadSegmentIndex = incomingIndex == null ? cachedIndex : Math.max(cachedIndex, incomingIndex)
  if (furthestReadSegmentIndex === incomingIndex) return incoming
  return {
    ...incoming,
    data: {
      ...incoming.data,
      furthestReadSegmentIndex,
    },
  }
}

export const useListStudySessions = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.studySessions.list.queryOptions({
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load sessions` },
    })
  )
}

export const useCreateStudySession = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.create.mutationOptions({
      meta: {
        invalidates: [orpcQuery.studySessions.list.key()],
        errorMessage: t`Failed to create session`,
        showErrorModal: true,
      },
    })
  )
}

export const useSearchTmdb = (query: string, enabled: boolean) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.contentSources.searchTmdb.queryOptions({
      input: { query },
      select: (response) => response.data,
      enabled,
      meta: { errorMessage: t`TMDB search failed` },
    })
  )
}

export const useCreateContentSourceFromTmdb = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.contentSources.createFromTmdb.mutationOptions({
      meta: {
        errorMessage: t`Failed to register movie`,
        showErrorModal: true,
      },
    })
  )
}

export const useSearchTmdbTv = (query: string, enabled: boolean) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.contentSources.searchTmdbTv.queryOptions({
      input: { query },
      select: (response) => response.data,
      enabled,
      meta: { errorMessage: t`TMDB search failed` },
    })
  )
}

export const useTmdbTvSeasons = (tmdbId: number | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.contentSources.tmdbTvSeasons.queryOptions({
      input: { tmdbId: tmdbId ?? 0 },
      select: (response) => response.data,
      enabled: tmdbId !== null,
      meta: { errorMessage: t`Failed to load seasons` },
    })
  )
}

export const useTmdbTvEpisodes = (tmdbId: number | null, seasonNumber: number | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.contentSources.tmdbTvEpisodes.queryOptions({
      input: { tmdbId: tmdbId ?? 0, seasonNumber: seasonNumber ?? 0 },
      select: (response) => response.data,
      enabled: tmdbId !== null && seasonNumber !== null,
      meta: { errorMessage: t`Failed to load episodes` },
    })
  )
}

export const useCreateContentSourceFromTmdbTv = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.contentSources.createFromTmdbTv.mutationOptions({
      meta: {
        errorMessage: t`Failed to register episode`,
        showErrorModal: true,
      },
    })
  )
}

export const useCreateContentSourceFromText = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.contentSources.createText.mutationOptions({
      meta: {
        errorMessage: t`Failed to register text`,
        showErrorModal: true,
      },
    })
  )
}

export const useSearchOpenSubtitles = (input: { tmdbId: number; language: string } | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.textTracks.searchOpenSubtitles.queryOptions({
      input: input ?? { tmdbId: 0, language: '' },
      select: (response) => response.data,
      enabled: input !== null,
      meta: { errorMessage: t`OpenSubtitles search failed` },
    })
  )
}

export const useSearchOpenSubtitlesEpisode = (
  input: { tmdbShowId: number; seasonNumber: number; episodeNumber: number; language: string } | null
) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.textTracks.searchOpenSubtitlesEpisode.queryOptions({
      input: input ?? { tmdbShowId: 0, seasonNumber: 0, episodeNumber: 0, language: '' },
      select: (response) => response.data,
      enabled: input !== null,
      meta: { errorMessage: t`OpenSubtitles search failed` },
    })
  )
}

export const useImportFromOpenSubtitles = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.textTracks.importFromOpenSubtitles.mutationOptions({
      meta: {
        errorMessage: t`Failed to import subtitles`,
        showErrorModal: true,
      },
    })
  )
}

export const useUploadSrt = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.textTracks.uploadSrt.mutationOptions({
      meta: {
        errorMessage: t`Failed to upload subtitles`,
        showErrorModal: true,
      },
    })
  )
}

export const useImportFromPaste = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.textTracks.importFromPaste.mutationOptions({
      meta: {
        errorMessage: t`Failed to import pasted text`,
        showErrorModal: true,
      },
    })
  )
}

export const useGetUserPrefs = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.userPrefs.getPrefs.queryOptions({
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load preferences` },
    })
  )
}

export const useSetCefrForLanguage = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setCefrForLanguage.mutationOptions({
      meta: {
        // Coverage rides along: setting a CEFR level is how a language enters
        // targetLanguagePrefs, and the coverage card enumerates from there.
        invalidates: [orpcQuery.userPrefs.getPrefs.key(), orpcQuery.coverage.getCoverage.key()],
        errorMessage: t`Failed to set CEFR level`,
        showErrorModal: true,
      },
    })
  )
}

export const useGetStudySession = (sessionId: string, options?: { enabled?: boolean }) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.studySessions.get.queryOptions({
      input: { sessionId },
      enabled: options?.enabled ?? true,
      select: (response) => response.data,
      structuralSharing: mergeFurthestReadSegmentIndex,
      meta: { errorMessage: t`Failed to load session` },
    })
  )
}

export const useGetSessionDeletePreview = (sessionId: string | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.studySessions.getDeletePreview.queryOptions({
      input: { sessionId: sessionId ?? '' },
      enabled: !!sessionId,
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load session counts` },
    })
  )
}

export const useRemoveStudySession = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.studySessions.remove.mutationOptions({
      // Optimistically drop the session from the cached list so the row
      // disappears the moment the user confirms.
      onMutate: ({ sessionId }) =>
        applyOptimistic(queryClient, [
          optimisticPatch<{ data: Array<{ id: string }> }>(orpcQuery.studySessions.list.key(), (cached) => {
            if (!cached?.data) return cached
            return { ...cached, data: cached.data.filter((s) => s.id !== sessionId) }
          }),
        ]),
      onError: (_error, _variables, context) => context?.rollback(),
      meta: {
        invalidates: [orpcQuery.studySessions.list.key()],
        successMessage: t`Session removed`,
        errorMessage: t`Failed to remove session`,
        showErrorModal: true,
      },
    })
  )
}

export const useGetStudySessionStatus = (sessionId: string, refetchInterval?: number) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.studySessions.getStatus.queryOptions({
      input: { sessionId },
      select: (response) => response.data,
      refetchInterval,
      meta: { errorMessage: t`Failed to load session status` },
    })
  )
}

// Session-vocabulary loaders: poll the background enrichment job state while anything is
// still in flight, then stop. Mirrors useGetStudySessionStatus.
export const useGetProcessingStatus = (sessionId: string, refetchInterval?: number) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.studySessions.getProcessingStatus.queryOptions({
      input: { sessionId },
      // Never query without a session scope (e.g. the vocabulary view passes '').
      enabled: sessionId.length > 0,
      select: (response) => response.data,
      refetchInterval: (query) => {
        const data = query.state.data?.data
        // Keep polling while enrichment OR a seeded chat answer is still in flight.
        const active = !!data && (data.enrichingHighlightIds.length > 0 || data.seedChatHighlightIds.length > 0)
        return active ? (refetchInterval ?? 2000) : false
      },
      meta: { errorMessage: t`Failed to load processing status` },
    })
  )
}

export const useRetryEnrichment = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.retryEnrichment.mutationOptions({
      meta: {
        invalidates: [orpcQuery.studySessions.getProcessingStatus.key({ input: { sessionId } })],
        errorMessage: t`Failed to retry enrichment`,
      },
    })
  )
}

// Fire-and-forget write of the reader's furthest-read position. Stays silent on
// failure — it's resume-position telemetry, not a user-facing action.
//
// We never *invalidate* the session query (no refetch on every throttled ping), but
// we DO optimistically patch its cache synchronously in onMutate. Without that, the
// cached session lags the DB by a full open/close cycle: the restore-on-open effect
// reads the stale cached value (and locks it in) before any background refetch can
// correct it, so the reader lands at their previous position, not the latest. The
// patch is monotonic (Math.max), matching the server's GREATEST; useGetStudySession
// applies the same merge to GET responses so a racing refetch cannot lower it.
export const useUpdateReadingProgress = () => {
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.studySessions.updateReadingProgress.mutationOptions({
      onMutate: ({ sessionId, segmentIndex }) => {
        // An advance means normal monotonic semantics are back — re-arm the
        // merge guard a manual set may have stood down.
        manualReadingPositionSessionIds.delete(sessionId)
        const key = orpcQuery.studySessions.get.queryKey({ input: { sessionId } })
        queryClient.setQueryData<StudySessionQueryData>(key, (cached) => {
          if (!cached?.data) return cached
          const cur = cached.data.furthestReadSegmentIndex
          const next = cur == null ? segmentIndex : Math.max(cur, segmentIndex)
          return { ...cached, data: { ...cached.data, furthestReadSegmentIndex: next } }
        })
      },
      meta: { showErrorModal: false },
    })
  )
}

// The manual bookmark ("read up to here"): an explicit, possibly-backward SET
// of the pointer from the reader's placement mode. Patches the cache to the
// exact value (the merge guard stands down via manualReadingPositionSessionIds)
// and refetches everything whose span hangs off the pointer.
export const useSetReadingPosition = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.studySessions.setReadingPosition.mutationOptions({
      onMutate: ({ segmentIndex }) => {
        manualReadingPositionSessionIds.add(sessionId)
        const key = orpcQuery.studySessions.get.queryKey({ input: { sessionId } })
        queryClient.setQueryData<StudySessionQueryData>(key, (cached) => {
          if (!cached?.data) return cached
          return { ...cached, data: { ...cached.data, furthestReadSegmentIndex: segmentIndex } }
        })
      },
      meta: {
        invalidates: [
          orpcQuery.studySessions.get.key({ input: { sessionId } }),
          orpcQuery.studySessions.getCheckpointPreview.key(),
          orpcQuery.studySessions.getMarkKnownPreview.key({ input: { sessionId } }),
        ],
        errorMessage: t`Failed to set the reading position`,
      },
    })
  )
}

// --- Checkpoint reviews (docs/SRS.md §6b / docs/READER-SPEC.md) ---------------

// Every checkpoint mutation must refresh the same trio: the practice summary
// (credits consume the review budget), the session (reviewedUntilSegmentIndex
// moved), and the preview badge — without the explicit preview key the badge
// keeps showing stale counts after a collect/undo.
const checkpointInvalidates = (sessionId: string) => [
  ...practiceSummaryKeys(),
  // Credits/assertions move FSRS state, so the difficulty stat shifts too.
  ...difficultyInvalidates(),
  orpcQuery.studySessions.get.key({ input: { sessionId } }),
  orpcQuery.studySessions.getCheckpointPreview.key(),
  // Collect mints a checkpoint, assert/undo change which candidates are still
  // assertable — the claims rehydration query must track all of them.
  orpcQuery.studySessions.getCheckpointClaims.key({ input: { sessionId } }),
]

// Footer badge counts. The CALLER debounces `toSegmentIndex` (a raw
// furthest-read index would mint a new query key per scrolled segment); pass
// null while there is nothing to preview.
export const useCheckpointPreview = (sessionId: string, toSegmentIndex: number | null) => {
  return useQuery(
    orpcQuery.studySessions.getCheckpointPreview.queryOptions({
      input: { sessionId, toSegmentIndex: toSegmentIndex ?? 0 },
      enabled: toSegmentIndex != null,
      select: (response) => response.data,
      // Passive badge data — never toast for it.
      meta: { showErrorToast: false },
    })
  )
}

// The latest live checkpoint's still-assertable backlog candidates — the
// claims sheet's data source across remounts (the collect response only feeds
// the mount that pressed the button; a reload would otherwise lose the
// re-entry forever).
export const useCheckpointClaims = (sessionId: string, enabled: boolean) => {
  return useQuery(
    orpcQuery.studySessions.getCheckpointClaims.queryOptions({
      input: { sessionId },
      enabled,
      select: (response) => response.data,
      // Passive rehydration data — never toast for it.
      meta: { showErrorToast: false },
    })
  )
}

// The checkpoint press. Errors are handled by the caller (CONFLICT gets a
// refetch-and-retry toast, not the generic failure path).
export const useCollectCheckpoint = (sessionId: string) => {
  return useMutation(
    orpcQuery.studySessions.collectCheckpoint.mutationOptions({
      meta: {
        invalidates: checkpointInvalidates(sessionId),
        showErrorToast: false,
      },
    })
  )
}

export const useUndoCheckpoint = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.undoCheckpoint.mutationOptions({
      meta: {
        invalidates: checkpointInvalidates(sessionId),
        errorMessage: t`Failed to undo the collected reviews`,
      },
    })
  )
}

export const useAssertKnownBacklog = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.assertKnownBacklog.mutationOptions({
      meta: {
        invalidates: checkpointInvalidates(sessionId),
        errorMessage: t`Failed to mark the words as known`,
      },
    })
  )
}

export const useUndoKnownAssertions = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.undoKnownAssertions.mutationOptions({
      meta: {
        invalidates: checkpointInvalidates(sessionId),
        errorMessage: t`Failed to undo`,
      },
    })
  )
}

// --- Personalized difficulty (docs/READER-SPEC.md) ---------------------------

export type SessionDifficulty = {
  status: 'available' | 'pending' | 'failed' | 'unsupported'
  expectedCoveragePercent: number | null
  label: 'comfortable' | 'challenging' | 'frustrating' | null
  unknownLemmaCount: number | null
  frequentUnknownCount: number | null
  savedNotStartedCount: number | null
  knownLemmaCount: number | null
}

// The contract caps one call at 100 unique ids; longer visible lists chunk
// into parallel calls whose results merge below.
const DIFFICULTY_BATCH_LIMIT = 100

const DIFFICULTY_PENDING_POLL_MS = 4000

// Batched difficulty stats for the visible session list (one call per ≤100
// ids). Polls gently while any session's profile build is still pending, then
// stops; passive meta data — never toast for it.
export const useSessionDifficulties = (sessionIds: readonly string[]) => {
  const uniqueIds = useMemo(() => [...new Set(sessionIds)].sort(), [sessionIds])
  const chunks = useMemo(() => {
    const result: string[][] = []
    for (let i = 0; i < uniqueIds.length; i += DIFFICULTY_BATCH_LIMIT) {
      result.push(uniqueIds.slice(i, i + DIFFICULTY_BATCH_LIMIT))
    }
    return result
  }, [uniqueIds])

  const results = useQueries({
    queries: chunks.map((ids) =>
      orpcQuery.studySessions.getDifficulties.queryOptions({
        input: { sessionIds: ids },
        select: (response) => response.data.difficulties,
        // refetchInterval sees the RAW cached response, not the select view.
        refetchInterval: (query) => {
          const map = query.state.data?.data.difficulties
          const anyPending = !!map && Object.values(map).some((d) => d.status === 'pending')
          return anyPending ? DIFFICULTY_PENDING_POLL_MS : false
        },
        meta: { showErrorToast: false },
      })
    ),
  })

  const difficulties: Record<string, SessionDifficulty> = {}
  for (const result of results) {
    if (result.data) Object.assign(difficulties, result.data)
  }
  return { difficulties, isLoading: results.some((r) => r.isLoading) }
}

// Exact count the mark-known sweep would insert. Whole-text (no
// toSegmentIndex) polls while the track's lemma profile is still building
// (the server re-enqueues it) and STOPS on 'failed' (terminal build failure —
// polling would re-enqueue forever); a span preview tokenizes live
// server-side and is never pending.
export const useMarkKnownPreview = (sessionId: string, enabled: boolean, toSegmentIndex?: number | null) => {
  return useQuery(
    orpcQuery.studySessions.getMarkKnownPreview.queryOptions({
      input: { sessionId, ...(toSegmentIndex != null ? { toSegmentIndex } : {}) },
      enabled,
      select: (response) => response.data,
      // Span callers re-key as the debounced reading pointer advances; holding
      // the previous span's data across the swap keeps count-driven UI (the
      // footer dock) from blinking out while the new key loads. First-ever
      // loads still report isLoading (no previous data to hold).
      placeholderData: keepPreviousData,
      refetchInterval: (query) => (query.state.data?.data.status === 'pending' ? 2500 : false),
      meta: { showErrorToast: false },
    })
  )
}

export const useMarkRemainingKnown = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.markRemainingKnown.mutationOptions({
      meta: {
        invalidates: [
          ...difficultyInvalidates(),
          orpcQuery.studySessions.getMarkKnownPreview.key({ input: { sessionId } }),
        ],
        errorMessage: t`Failed to mark the words as known`,
      },
    })
  )
}

// Bulk correction for sweep-created known marks. With a sweepBatchId (the
// one the sweep response returned) it reverts exactly that press — the
// success toast's Undo; without one it clears every mark this session's
// sweeps created — the difficulty sheet's demoted action.
export const useUnmarkKnownBySession = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.unmarkKnownBySession.mutationOptions({
      meta: {
        invalidates: [
          ...difficultyInvalidates(),
          orpcQuery.studySessions.getMarkKnownPreview.key({ input: { sessionId } }),
        ],
        errorMessage: t`Failed to remove the known marks`,
      },
    })
  )
}

// Bare un-mark behind the gloss sheet's "Marked as known" chip — removes ALL
// candidate lemmas the selected token represents (the ones the gloss
// returned), zero SRS side effects.
export const useUnmarkKnownLemma = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.unmarkKnownLemma.mutationOptions({
      meta: {
        invalidates: [...difficultyInvalidates()],
        errorMessage: t`Failed to remove the known mark`,
      },
    })
  )
}

export const useListSegmentsByTrack = (textTrackId: string | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.textSegments.listByTrack.queryOptions({
      input: { textTrackId: textTrackId ?? '' },
      select: (response) => response.data,
      enabled: !!textTrackId,
      meta: { errorMessage: t`Failed to load subtitle segments` },
    })
  )
}

export const useSearchSegments = (textTrackId: string | null, query: string, enabled: boolean) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.textSegments.search.queryOptions({
      input: { textTrackId: textTrackId ?? '', q: query },
      select: (response) => response.data,
      enabled: enabled && !!textTrackId && query.length > 0,
      meta: { errorMessage: t`Search failed` },
    })
  )
}

export const useListHighlightsBySession = (sessionId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.highlights.listBySession.queryOptions({
      input: { sessionId },
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load highlights` },
    })
  )
}

export const useCreateHighlight = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.highlights.create.mutationOptions({
      // Optimistic paint (extension parity): insert a temp row so the span
      // washes yellow the moment the user saves, instead of after the
      // invalidate round-trip. onSuccess swaps the temp row for the server
      // row; meta.invalidates still settles the cache to the server's truth.
      onMutate: async (vars) => {
        const tempId = `${OPTIMISTIC_HIGHLIGHT_ID_PREFIX}${crypto.randomUUID()}`
        const optimisticRow: Highlight = {
          id: tempId,
          studySessionId: vars.sessionId,
          startSegmentId: vars.startSegmentId,
          endSegmentId: vars.endSegmentId,
          startOffset: vars.startOffset,
          endOffset: vars.endOffset,
          selectionText: vars.selectionText,
          note: vars.note ?? null,
          presetTags: vars.presetTags ?? [],
          fastGloss: vars.fastGloss
            ? `${vars.fastGloss.gloss}\n${vars.fastGloss.pos ?? ''}\n${vars.fastGloss.register ?? ''}`
            : null,
          // Carry the chosen intent so the saved sheet reads it back immediately;
          // chunkId is null until the enrich job materializes the term.
          studyIntent: vars.studyIntent ?? null,
          chunkId: null,
          noteOnly: vars.noteOnly ?? false,
          createdAt: new Date().toISOString(),
        }
        const ctx = await applyOptimistic(queryClient, [
          optimisticPatch<{ data: Highlight[] }>(
            orpcQuery.highlights.listBySession.key({ input: { sessionId } }),
            (cached) => (cached ? { ...cached, data: [...cached.data, optimisticRow] } : cached)
          ),
        ])
        return { ...ctx, tempId }
      },
      onError: (_error, _variables, context) => context?.rollback(),
      onSuccess: (res, _variables, context) => {
        if (!context) return
        queryClient.setQueryData<{ data: Highlight[] }>(
          orpcQuery.highlights.listBySession.queryKey({ input: { sessionId } }),
          (cached) =>
            cached ? { ...cached, data: cached.data.map((h) => (h.id === context.tempId ? res.data : h)) } : cached
        )
      },
      meta: {
        invalidates: [
          orpcQuery.highlights.listBySession.key({ input: { sessionId } }),
          // A pre-save ghost adoption (adoptedGhostId) dismisses the ghost
          // server-side; refetch so its outline leaves the reader. Harmless
          // (no live ghost change) on a plain save.
          orpcQuery.ghosts.listBySession.key({ input: { sessionId } }),
        ],
        // No success toast: the span turning yellow is the save feedback, and a
        // toast per word gets noisy (and overlaps buttons on mobile) when the
        // user saves dozens of words in a row.
        errorMessage: t`Failed to save highlight`,
      },
    })
  )
}

export const useProcessStudySession = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.process.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.studySessions.get.key({ input: { sessionId } }),
          orpcQuery.studySessions.getStatus.key({ input: { sessionId } }),
        ],
        successMessage: t`Opening Session vocabulary`,
        errorMessage: t`Failed to open Session vocabulary`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetNativeLanguage = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setNativeLanguage.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to set native language`,
        showErrorModal: true,
      },
    })
  )
}

export const useCompleteOnboarding = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.completeOnboarding.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to complete onboarding`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetLlmHighlightsEnabled = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setLlmHighlightsEnabled.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to update LLM-highlights setting`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetShowTranslationsForLanguage = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setShowTranslationsForLanguage.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to update show-translations setting`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetEnglishIpaDialect = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setEnglishIpaDialect.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to update English IPA dialect`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetUiTheme = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setUiTheme.mutationOptions({
      // invalidates fires on settle, so it also covers errors: the theme is
      // applied optimistically, and <UserUiPrefsSync /> re-applies the server
      // value on refetch, reverting a failed optimistic change.
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to update theme`,
      },
    })
  )
}

export const useSetUiLanguage = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setUiLanguage.mutationOptions({
      // invalidates fires on settle, so it also covers errors: the locale is
      // activated optimistically, and <UserUiPrefsSync /> re-applies the
      // server value on refetch.
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to update interface language`,
      },
    })
  )
}

// Feeds the home getting-started checklist. `enabled: false` once the
// checklist is dismissed/completed — the signals stop mattering forever, so
// the endpoint must not be polled for established users.
export const useGettingStartedStatus = (enabled: boolean) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.userPrefs.gettingStartedStatus.queryOptions({
      enabled,
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load your progress` },
    })
  )
}

export const useAddAccountFlag = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.addAccountFlag.mutationOptions({
      // Flags are append-only and the endpoint is idempotent, so retrying is
      // safe and prevents a transient failure from stranding one-time UI.
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000),
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        errorMessage: t`Failed to save your preference`,
      },
    })
  )
}

export const useSetPracticeLimitsForLanguage = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setPracticeLimitsForLanguage.mutationOptions({
      meta: {
        // The limits feed the practice landing's budgets and session-plan
        // preview, so those must recompute alongside the prefs themselves.
        invalidates: [orpcQuery.userPrefs.getPrefs.key(), ...practiceSummaryKeys()],
        errorMessage: t`Failed to update practice limits`,
        showErrorModal: true,
      },
    })
  )
}

export const useFastGloss = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.highlights.fastGloss.mutationOptions({
      meta: {
        errorMessage: t`Quick gloss failed`,
      },
    })
  )
}

// Free, stateless gloss for an arbitrary selection in its sentence context.
// Creates no rows and fires no enrich/card job — used for the preview-first
// gloss sheet, where looking is free and only an explicit Save persists.
export const useStatelessGloss = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.glosses.fastGloss.mutationOptions({
      meta: {
        errorMessage: t`Quick gloss failed`,
      },
    })
  )
}

export const useUpdateHighlightNoteAndTags = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.highlights.updateNoteAndTags.mutationOptions({
      meta: {
        invalidates: [orpcQuery.highlights.listBySession.key({ input: { sessionId } })],
        successMessage: t`Note saved`,
        errorMessage: t`Failed to update highlight`,
      },
    })
  )
}

// Upgrade a note-only stub into a full study card (persists the study intent +
// runs the normal enrichment; note/chat survive). No success toast — the sheet
// morphing into the normal saved state is the feedback.
export const useSaveWord = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.highlights.saveWord.mutationOptions({
      meta: {
        invalidates: [orpcQuery.highlights.listBySession.key({ input: { sessionId } })],
        errorMessage: t`Failed to save the word`,
      },
    })
  )
}

export const useDeleteHighlight = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.highlights.delete.mutationOptions({
      meta: {
        // Removing a highlight can remove the term from the vocabulary, which
        // moves the difficulty stat's saved buckets.
        invalidates: [orpcQuery.highlights.listBySession.key({ input: { sessionId } }), ...difficultyInvalidates()],
        errorMessage: t`Failed to remove highlight`,
      },
    })
  )
}

// --- Phase 2: ghost candidates -------------------------------------------------

// Live ghost candidates + the nomination coverage set. Polls while any requested
// window is still being nominated (status='pending'), then stops — new outlines
// appear as the worker drains windows.
export const useListGhostsBySession = (sessionId: string, enabled = true, refetchInterval = 2000) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.ghosts.listBySession.queryOptions({
      input: { sessionId },
      enabled,
      select: (response) => response.data,
      refetchInterval: (query) => {
        const data = query.state.data?.data
        const anyPending = !!data && data.windows.some((w) => w.status === 'pending')
        return anyPending ? refetchInterval : false
      },
      meta: { errorMessage: t`Failed to load suggestions` },
    })
  )
}

export const useNominateWindow = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.ghosts.nominateWindow.mutationOptions({
      meta: {
        // Refresh the coverage set so the just-requested window shows as pending
        // and the poll re-arms.
        invalidates: [orpcQuery.ghosts.listBySession.key({ input: { sessionId } })],
        errorMessage: t`Failed to request suggestions`,
      },
    })
  )
}

export const useSwitchGhost = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.ghosts.switch.mutationOptions({
      meta: {
        // The provisional highlight was swapped for the ghost's span and the ghost
        // dismissed — refresh both lists.
        invalidates: [
          orpcQuery.highlights.listBySession.key({ input: { sessionId } }),
          orpcQuery.ghosts.listBySession.key({ input: { sessionId } }),
        ],
        errorMessage: t`Failed to use suggestion`,
      },
    })
  )
}
