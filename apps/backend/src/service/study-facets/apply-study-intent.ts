import { StudyIntent } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { normalizeTargetForm } from '@flicktionary/core/utils/normalize-target-form'
import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import {
  CITATION_FORM,
  StudyFacetsRepositoryInterface,
  StudyIntentFacetSpec,
} from '../../transport/database/study-facets/study-facets-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { generateFormFacetData, GenerateFormFacetDataDeps } from './generate-form-facet-data'
import { reconcilePronunciationFacet } from './reconcile-pronunciation-facet'

export type ApplyStudyIntentDeps = {
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
}

// A form facet the intent created (or re-enabled) — the caller follows up with
// generateStudyIntentFormData for any of these still pending data. Pronunciation
// is never a form target (per-form IPA is roadmap), hence the narrowed skill.
export type StudyIntentFormTarget = {
  skill: 'meaning_recognition' | 'meaning_production'
  targetForm: string
}

export type ApplyStudyIntentResult = {
  applied: boolean
  formFacetTargets: StudyIntentFormTarget[]
}

// Apply a gloss-save study intent to a freshly-materialized (or re-encountered)
// term. FULL-SET semantics for the citation facets: exactly the intent's skills
// get (re-)enabled citation facets — recognition only if listed. Because the
// facet rows are created here, BEFORE any keep transition, the keep-time
// default (ensureDefaultCitationFacetIfUnconfigured's row-existence check)
// correctly skips force-adding recognition. Application is enable-only and
// additive on term dedupe: it never disables an existing facet.
//
// `formScope: 'both'` adds form facets of the encountered surface form for the
// intent's MEANING skills — unless the surface IS the headword (the client
// never knows the lemma, so the lemma-collapse decision lives here): then the
// citation facets already cover it and no duplicate form facet is minted. Form
// facets key on normalizeTargetForm(surface); the payload keeps the display
// form (stress intact). New form facets are born pending_data /
// source='highlight' (an existing facet keeps its data and status).
//
// `appliedGuardHighlightId` (the async enrichment path) makes application
// exactly-once: the highlight's study_intent_applied_at is stamped atomically
// with the facet writes, and a retry no-ops. The pronunciation reconcile runs
// post-commit: an intent enabling pronunciation on a term with no displayable
// IPA gets that facet deleted again (Trap 12), same as the term-view enable.
export const applyStudyIntent = async (
  params: {
    userLookupId: string
    userId: string
    surfaceForm: string
    intent: StudyIntent
    appliedGuardHighlightId?: string
  },
  deps: ApplyStudyIntentDeps
): Promise<ApplyStudyIntentResult> => {
  const notApplied: ApplyStudyIntentResult = { applied: false, formFacetTargets: [] }

  // Ownership / existence guard (and the headword for the lemma collapse).
  const lookup = await deps.userLookupsRepository.findByIdForUser(params.userLookupId, params.userId)
  if (!lookup) return notApplied

  const skills = [...new Set(params.intent.skills)]
  const normalizedForm = normalizeTargetForm(params.surfaceForm)
  const wantFormFacets =
    params.intent.formScope === 'both' &&
    normalizedForm !== '' &&
    normalizedForm !== normalizeTargetForm(lookup.headword)

  const facets: StudyIntentFacetSpec[] = skills.map((skill) => ({
    userLookupId: params.userLookupId,
    skill,
    targetForm: CITATION_FORM,
  }))

  const formFacetTargets: StudyIntentFormTarget[] = wantFormFacets
    ? skills
        .filter((s): s is StudyIntentFormTarget['skill'] => s !== 'pronunciation')
        .map((skill) => ({ skill, targetForm: normalizedForm }))
    : []
  for (const target of formFacetTargets) {
    facets.push({
      userLookupId: params.userLookupId,
      skill: target.skill,
      targetForm: target.targetForm,
      dataStatus: 'pending_data',
      source: 'highlight',
      payload: { form: params.surfaceForm },
    })
  }

  const applied = await deps.studyFacetsRepository.applyStudyIntentFacets({
    userLookupId: params.userLookupId,
    facets,
    guardHighlightId: params.appliedGuardHighlightId,
  })
  if (!applied) return notApplied

  if (skills.includes('pronunciation')) {
    await reconcilePronunciationFacet(
      deps.userLookupsRepository,
      params.userLookupId,
      (lookup.grammar ?? {}) as Record<string, unknown>,
      lookup.target_language
    )
  }

  return { applied: true, formFacetTargets }
}

// Fill the intent's form facets via the Opus pass — the auto-generation that
// keeps a popover-created form card from sitting pending_data until the user
// happens to visit the term view. Only facets STILL pending data are touched: a
// re-encountered form whose facet already carries generated or hand-edited
// content is never regenerated or overwritten. Sibling skills of the same form
// reuse the one generated payload (a single Opus call per form — mirroring the
// term view's "enabling a second skill on a filled form reuses the known
// data"). Never throws: a failure leaves the facet pending_data, where the term
// view's existing generate/retry chip takes over — and on the enrichment path a
// thrown error would only trigger a job retry that the applied_at guard skips
// anyway.
export const generateStudyIntentFormData = async (
  params: {
    userLookupId: string
    userId: string
    formFacetTargets: StudyIntentFormTarget[]
    encounteredSentence: string | null
  },
  deps: GenerateFormFacetDataDeps
): Promise<void> => {
  if (params.formFacetTargets.length === 0) return
  try {
    const facets = await deps.userLookupsRepository.listFacetsForChunk(params.userLookupId)
    const pending = params.formFacetTargets.filter((t) =>
      facets.some((f) => f.skill === t.skill && f.targetForm === t.targetForm && f.dataStatus === 'pending_data')
    )

    const byForm = new Map<string, StudyIntentFormTarget[]>()
    for (const target of pending) {
      byForm.set(target.targetForm, [...(byForm.get(target.targetForm) ?? []), target])
    }

    for (const [targetForm, targets] of byForm) {
      const [first, ...siblings] = targets
      if (!first) continue
      const outcome = await generateFormFacetData(
        {
          chunkId: params.userLookupId,
          userId: params.userId,
          skill: first.skill,
          targetForm,
          encounteredSentence: params.encounteredSentence,
        },
        deps
      )
      if (outcome !== 'generated' || siblings.length === 0) continue

      const refreshed = await deps.userLookupsRepository.listFacetsForChunk(params.userLookupId)
      const generated = refreshed.find((f) => f.skill === first.skill && f.targetForm === targetForm)
      if (!generated) continue
      for (const sibling of siblings) {
        await deps.userLookupsRepository.setFacetPayload({
          userLookupId: params.userLookupId,
          userId: params.userId,
          skill: sibling.skill,
          targetForm: sibling.targetForm,
          payload: generated.payload,
          generatedPayload: generated.generatedPayload ?? generated.payload,
        })
      }
    }
  } catch (e) {
    logCustomErrorMessageAndError(
      `generateStudyIntentFormData failed, userLookupId = ${params.userLookupId}`,
      e
    )
  }
}
