import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { applyOptimistic, optimisticPatch } from '@/lib/query/optimistic'
import type { Highlight, StudySession } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

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

const mergeFurthestReadSegmentIndex = (cached: unknown, incoming: unknown): unknown => {
  if (!isStudySessionQueryData(incoming)) return incoming
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
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
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

export const useSetPracticeLimitsForLanguage = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.userPrefs.setPracticeLimitsForLanguage.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
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

export const useDeleteHighlight = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.highlights.delete.mutationOptions({
      meta: {
        invalidates: [orpcQuery.highlights.listBySession.key({ input: { sessionId } })],
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
