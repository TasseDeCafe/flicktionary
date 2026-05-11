import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

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
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.studySessions.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.studySessions.list.key() })
      },
      meta: {
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
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.userPrefs.setCefrForLanguage.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.userPrefs.getPrefs.key() })
      },
      meta: {
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
      onMutate: async (variables: { sessionId: string }) => {
        const listKey = orpcQuery.studySessions.list.key()
        await queryClient.cancelQueries({ queryKey: listKey })
        const previous = queryClient.getQueryData(listKey)
        queryClient.setQueryData<{ data: Array<{ id: string }> }>(listKey, (cached) => {
          if (!cached?.data) return cached
          return { ...cached, data: cached.data.filter((s) => s.id !== variables.sessionId) }
        })
        return { listKey, previous }
      },
      onError: (_error, _variables, context) => {
        if (!context) return
        const ctx = context as { listKey: readonly unknown[]; previous: unknown }
        if (ctx.previous !== undefined) queryClient.setQueryData(ctx.listKey, ctx.previous)
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.studySessions.list.key() })
      },
      meta: {
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
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.highlights.listBySession.key({ input: { sessionId } }),
        })
      },
      meta: {
        errorMessage: t`Failed to save highlight`,
      },
    })
  )
}

export const useProcessStudySession = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.studySessions.process.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.studySessions.get.key({ input: { sessionId } }),
        })
        queryClient.invalidateQueries({
          queryKey: orpcQuery.studySessions.getStatus.key({ input: { sessionId } }),
        })
      },
      meta: {
        successMessage: t`Processing started`,
        errorMessage: t`Failed to start processing`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetNativeLanguage = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.userPrefs.setNativeLanguage.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.userPrefs.getPrefs.key() })
      },
      meta: {
        errorMessage: t`Failed to set native language`,
        showErrorModal: true,
      },
    })
  )
}

export const useCompleteOnboarding = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.userPrefs.completeOnboarding.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.userPrefs.getPrefs.key() })
      },
      meta: {
        errorMessage: t`Failed to complete onboarding`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetTapToTranslateEnabled = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.userPrefs.setTapToTranslateEnabled.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.userPrefs.getPrefs.key() })
      },
      meta: {
        errorMessage: t`Failed to update tap-to-translate setting`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetLlmHighlightsEnabled = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.userPrefs.setLlmHighlightsEnabled.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.userPrefs.getPrefs.key() })
      },
      meta: {
        errorMessage: t`Failed to update LLM-highlights setting`,
        showErrorModal: true,
      },
    })
  )
}

export const useSetPracticeSessionLimits = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.userPrefs.setPracticeSessionLimits.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.userPrefs.getPrefs.key() })
      },
      meta: {
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

export const useUpdateHighlightNoteAndTags = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.highlights.updateNoteAndTags.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.highlights.listBySession.key({ input: { sessionId } }),
        })
      },
      meta: {
        successMessage: t`Note saved`,
        errorMessage: t`Failed to update highlight`,
      },
    })
  )
}

export const useDeleteHighlight = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.highlights.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.highlights.listBySession.key({ input: { sessionId } }),
        })
      },
      meta: {
        errorMessage: t`Failed to remove highlight`,
      },
    })
  )
}
