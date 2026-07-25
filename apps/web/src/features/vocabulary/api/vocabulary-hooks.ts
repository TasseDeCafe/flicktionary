import { orpcQuery } from '@/lib/transport/orpc-client'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { ChunksSort, VocabFilterSkill, VocabStatus } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { applyOptimistic, optimisticPatch, patchInfinitePages } from '@/lib/query/optimistic'
import {
  dropFacetFromComposedSession,
  dropTermFromComposedSession,
  patchFacetInComposedSession,
} from '@/features/practice/components/composed-session-snapshot'
import { dropTermFromExerciseSession } from '@/features/practice/components/exercise-session-snapshot'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'
import {
  getStudyTargetsKey,
  setRowProductionEnabled,
  upsertFacetEnabled,
  type StudyTargetsCache,
  type VocabListRow,
} from './facet-cache'

export const useListLanguages = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.chunks.listLanguages.queryOptions({
      input: {},
      select: (response) => response.languages,
      meta: { errorMessage: t`Failed to load languages` },
    })
  )
}

export const useListChunksInfinite = (params: {
  targetLanguage: string | null
  sort: ChunksSort
  q?: string
  limit?: number
  skills?: VocabFilterSkill[]
  status?: VocabStatus
  hasMultipleForms?: boolean
}) => {
  const { t } = useLingui()
  const targetLanguage = params.targetLanguage
  const q = params.q?.trim() ?? ''
  const skills = params.skills ?? []
  return useInfiniteQuery(
    orpcQuery.chunks.listChunks.infiniteOptions({
      enabled: Boolean(targetLanguage),
      input: (pageParam: string | null) => ({
        targetLanguage: targetLanguage ?? '',
        sort: params.sort,
        cursor: pageParam ?? null,
        limit: params.limit ?? 50,
        ...(q.length > 0 ? { q } : {}),
        // The wire takes skills as a CSV string (see the contract); join here.
        ...(skills.length > 0 ? { skills: skills.join(',') } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.hasMultipleForms ? { hasMultipleForms: true } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
      meta: { errorMessage: t`Failed to load vocabulary` },
    })
  )
}

// Enable or disable one study facet (skill x target_form) on a term. This is the
// unified study-target write path that replaced the old pool toggle: enabling
// the citation meaning_production facet is what "promote to production study"
// used to be (disable = demote), and the wire derives `isProductionEnabled` from
// that facet's enabled state. Optimism is two-pronged: the term's own study-
// targets view (the focus-view skills card/sheet) flips instantly for EVERY
// facet, and the vocab list's production chips flip for the production-citation
// case (the only facet with a list-visible flag).
export const useSetFacetEnabled = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.setFacetEnabled.mutationOptions({
      onMutate: ({ chunkId, skill, targetForm, enabled, payload }) => {
        const form = targetForm ?? ''
        // The vocab list's production chips only need patching for the
        // production-citation facet (the only one with a list-visible flag).
        const isProductionCitation = skill === 'meaning_production' && form === ''
        return applyOptimistic(queryClient, [
          // The term's own study targets — the chunk-scoped key matters, see
          // upsertFacetEnabled.
          optimisticPatch<StudyTargetsCache>(getStudyTargetsKey(chunkId), (old) =>
            upsertFacetEnabled(old, { skill, targetForm: form, enabled, payload })
          ),
          ...(isProductionCitation
            ? [
                optimisticPatch<{ pages: Array<{ rows: VocabListRow[] }> }>(orpcQuery.chunks.listChunks.key(), (old) =>
                  patchInfinitePages(old, (rows) => setRowProductionEnabled(rows, chunkId, enabled))
                ),
              ]
            : []),
        ])
      },
      onError: (_err, _vars, context) => context?.rollback(),
      meta: {
        // The Study-targets control reads facet membership from getStudyTargets;
        // refetch it so the just-toggled chip reflects the server state (the
        // pronunciation enable can also self-heal to "off" server-side when the
        // term has no IPA).
        invalidates: [
          orpcQuery.chunks.listChunks.key(),
          ...practiceSummaryKeys(),
          ...difficultyInvalidates(),
          orpcQuery.cards.get.key(),
          orpcQuery.cards.listBySession.key(),
          orpcQuery.chunks.getStudyTargets.key(),
        ],
        errorMessage: t`Failed to update study targets`,
        showErrorModal: true,
      },
    })
  )
}

// Read one term's study facets for the Study-targets control. Lazily fetched
// when the term view renders (kept off the chunk DTO so the vocab list stays
// lean). Returns `{ facets, candidateForms }`: the facet summaries drive chip
// membership / readiness, and candidateForms are the encountered surface forms
// the "+ Add a form" picker can still offer. `refetchInterval` lets the focus
// view poll while a background enrich_highlight job is filling a pending facet.
export const useStudyTargets = (chunkId: string | null, options?: { refetchInterval?: number | false }) => {
  const { t } = useLingui()
  const pollMs = options?.refetchInterval
  return useQuery(
    orpcQuery.chunks.getStudyTargets.queryOptions({
      enabled: Boolean(chunkId),
      input: { chunkId: chunkId ?? '' },
      select: (response) => response.data,
      // Self-stopping poll (mirrors useGetProcessingStatus): even while the
      // caller asks for an interval, stop once no facet is pending_data — the
      // background job filled it, or the user entered the data manually.
      refetchInterval: pollMs
        ? (query) => {
            const facets = query.state.data?.data.facets
            return facets?.some((facet) => facet.dataStatus === 'pending_data') ? pollMs : false
          }
        : false,
      meta: { errorMessage: t`Failed to load study targets` },
    })
  )
}

// Fill a pending_data form facet's render data via the Opus generate-and-confirm
// pass (the form's spelling + a translation of that exact inflection) and flip
// it to ready. The mutation response is the refreshed study-targets; we
// invalidate so the chip drops its "needs data" state. dueSummary refetches
// because a newly-ready form facet enters the opt-in-new queue.
export const useGenerateFacetData = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.generateFacetData.mutationOptions({
      // A stashed practice session embeds form cards' facetPayload — patch it
      // so the generated data shows when the session resumes (same rationale
      // as the chunk edit mutations' patchTermIn*Session calls).
      onSuccess: ({ data }, variables) => {
        patchFacetInComposedSession(variables.chunkId, data.facets)
      },
      meta: {
        invalidates: [orpcQuery.chunks.getStudyTargets.key(), ...practiceSummaryKeys()],
        errorMessage: t`Couldn't generate the form's data`,
        showErrorModal: true,
      },
    })
  )
}

// Manual counterpart to useGenerateFacetData: the user types the form's card
// content themselves (the "enter it yourself" escape from a pending_data facet,
// and the field-level edit path for an existing form facet). Merges the partial
// payload and flips to ready. Also invalidates cards.get/listBySession so a form
// edit reflects on the flashcard when the user returns to the card (the form's
// content now lives in the facet payload, which those queries carry).
export const useSetFacetPayload = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.setFacetPayload.mutationOptions({
      onSuccess: ({ data }, variables) => {
        patchFacetInComposedSession(variables.chunkId, data.facets)
      },
      meta: {
        invalidates: [
          orpcQuery.chunks.getStudyTargets.key(),
          ...practiceSummaryKeys(),
          orpcQuery.cards.get.key(),
          orpcQuery.cards.listBySession.key(),
        ],
        errorMessage: t`Couldn't save the form's data`,
        showErrorModal: true,
      },
    })
  )
}

// Explicit "Remove form" on a form chip: hard-deletes one study facet (skill x
// target_form) and its schedule (unlike disabling, this is irreversible short of
// re-adding the form). Refetches the study-targets so the chip disappears, and
// dueSummary because a removed facet leaves the queue.
export const useDeleteFacet = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.deleteFacet.mutationOptions({
      // A stashed practice session must not re-serve the deleted facet's cards
      // (rating a deleted facet fails) — the facet-scoped analog of the
      // soft-delete mutations' dropTermFromComposedSession call.
      onSuccess: (_data, variables) => {
        dropFacetFromComposedSession(variables.chunkId, variables.skill, variables.targetForm)
      },
      meta: {
        invalidates: [orpcQuery.chunks.getStudyTargets.key(), ...practiceSummaryKeys(), ...difficultyInvalidates()],
        errorMessage: t`Couldn't remove the form`,
        showErrorModal: true,
      },
    })
  )
}

export const useExportVocabularyCsv = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.exportCsv.mutationOptions({
      meta: { errorMessage: t`Failed to export vocabulary` },
    })
  )
}

// Soft-delete is a quick mutation but the optimistic UX matters: the row
// disappears the moment the user confirms. We do that by patching every
// in-flight infinite-query page to drop the row, then invalidate the whole
// chunks.listChunks family on settle so the server's view is the truth.
// Practice's dueSummary is also invalidated because deleting hides the chunk
// from the SRS queue.
export const useDeleteChunk = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.deleteChunk.mutationOptions({
      onMutate: ({ id }) =>
        applyOptimistic(queryClient, [
          optimisticPatch<{ pages: Array<{ rows: Array<{ id: string }> }> }>(orpcQuery.chunks.listChunks.key(), (old) =>
            patchInfinitePages(old, (rows) => rows.filter((row) => row.id !== id))
          ),
        ]),
      onError: (_err, _vars, context) => context?.rollback(),
      // An interrupted practice session stashed for resume (composed or
      // strengthen/warm-up) must not re-serve the deleted term's
      // cards/exercises.
      onSuccess: (_data, { id }) => {
        dropTermFromComposedSession(id)
        dropTermFromExerciseSession(id)
      },
      meta: {
        invalidates: [orpcQuery.chunks.listChunks.key(), ...practiceSummaryKeys(), ...difficultyInvalidates()],
        errorMessage: t`Failed to delete term`,
        showErrorModal: true,
      },
    })
  )
}
