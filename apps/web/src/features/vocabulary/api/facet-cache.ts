import { orpcQuery } from '@/lib/transport/orpc-client'
import type { StudyFacetSummary } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// The cached `getStudyTargets` query result (the raw response, before the
// `useStudyTargets` select unwraps `.data`).
export type StudyTargetsCache = { data: { facets: StudyFacetSummary[]; candidateForms: string[] } }

// One vocab-list row as the production-chip patch sees it.
export type VocabListRow = { id: string; isProductionEnabled: boolean }

export const getStudyTargetsKey = (chunkId: string) => orpcQuery.chunks.getStudyTargets.key({ input: { chunkId } })

// Flip the matching facet's enabled state, or insert it when enabling a skill
// with no row yet (mirrors the server's ensure-then-enable). `targetForm` must
// already be normalized ('' = citation). Pure updater — compose with
// `optimisticPatch(getStudyTargetsKey(chunkId), ...)`; the key MUST be scoped
// to the chunk: recognition's target_form '' is shared across every term, so a
// broad patch would corrupt siblings.
export const upsertFacetEnabled = (
  old: StudyTargetsCache | undefined,
  vars: {
    skill: StudyFacetSummary['skill']
    targetForm: string
    enabled: boolean
    payload?: Record<string, unknown>
  }
): StudyTargetsCache | undefined => {
  if (!old) return old
  const { skill, targetForm, enabled, payload } = vars
  const facets = old.data.facets
  const idx = facets.findIndex((f) => f.skill === skill && f.targetForm === targetForm)
  let nextFacets: StudyFacetSummary[]
  if (idx >= 0) {
    nextFacets = facets.map((f, i) =>
      i === idx ? { ...f, enabled, ...(payload ? { payload: { ...f.payload, ...payload } } : {}) } : f
    )
  } else if (enabled) {
    const isForm = targetForm !== ''
    const hasTranslation = !!payload && 'translation' in payload
    nextFacets = [
      ...facets,
      {
        skill,
        targetForm,
        enabled: true,
        dataStatus: isForm && !hasTranslation ? 'pending_data' : 'ready',
        srsState: null,
        payload: payload ?? {},
        generatedPayload: null,
        source: null,
      },
    ]
  } else {
    nextFacets = facets
  }
  return { ...old, data: { ...old.data, facets: nextFacets } }
}

// Flip one row's production chip in the vocab list (the only facet state with
// a list-visible flag). Pure row transform — compose with patchInfinitePages.
export const setRowProductionEnabled = (rows: VocabListRow[], chunkId: string, enabled: boolean): VocabListRow[] =>
  rows.map((row) => (row.id === chunkId ? { ...row, isProductionEnabled: enabled } : row))
