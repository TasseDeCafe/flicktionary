import type {
  DbPracticeExercise,
  ExerciseType,
  PracticeExercisesRepositoryInterface,
} from '../../transport/database/practice-exercises/practice-exercises-repository'
import type {
  DbUserLookup,
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import {
  CITATION_FORM,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import {
  generateExercisePass,
  type ExerciseTermInput,
  type GeneratableExerciseType,
  type GeneratedExercise,
} from '../../transport/third-party/anthropic/passes/generate-exercise-pass'
import { verifyExercisePass } from '../../transport/third-party/anthropic/passes/verify-exercise-pass'
import { getLanguageMode } from '../user-prefs/language-mode'
import { MAX_GEN_ATTEMPTS } from './leech-config'
import { gateTypeForTier, rehabCorrectDaysFor } from './rehab'

export type ExerciseBankDependencies = {
  practiceExercisesRepository: PracticeExercisesRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
}

// Pool-dependent exercise ladder. Recognition: MC cloze + MC comprehension.
// Production: MC cloze + production cloze (typed).
// Use-in-a-sentence ships for both pools but as ungated bonus only — its
// LLM grading must never block a leech graduation.
const requiredExerciseTypes = (pool: PracticePool): ExerciseType[] =>
  pool === 'recognition'
    ? ['mc_cloze', 'mc_comprehension', 'use_in_sentence']
    : ['mc_cloze', 'production_cloze', 'use_in_sentence']

// The gate-capable types of a pool: the required set minus use_in_sentence
// (LLM-graded, never gates). Used to decide whether a parked term's gate bank
// is still cooking or terminally exhausted.
const gateCapableTypes = (pool: PracticePool): ExerciseType[] =>
  requiredExerciseTypes(pool).filter((type) => type !== 'use_in_sentence')

const toTermInput = (lookup: DbUserLookup): ExerciseTermInput => ({
  headword: lookup.headword,
  sense: lookup.sense ?? '',
  translation: lookup.translation,
  definition: lookup.definition,
  targetExample: lookup.target_example,
})

// Generate + adversarially verify one slot, retrying the full cycle up to
// MAX_GEN_ATTEMPTS before marking the slot failed. The verifier runs in an
// independent context and rejects any exercise where a distractor is also
// acceptable — regeneration over repair, accuracy over cost.
const runExerciseGenerationForSlot = async (params: {
  slot: DbPracticeExercise
  lookup: DbUserLookup
  deps: ExerciseBankDependencies
}): Promise<void> => {
  const { slot, lookup, deps } = params
  const claim = await deps.practiceExercisesRepository.claimGenerating(slot.id)
  if (!claim) return

  // use_in_sentence has no generated content to verify: the payload is the
  // instruction itself, built deterministically. Mark ready immediately.
  if (slot.exercise_type === 'use_in_sentence') {
    await deps.practiceExercisesRepository.markReady({
      id: slot.id,
      token: claim.token,
      payload: { prompt: lookup.sense ?? '', term: lookup.headword },
      gateEligible: false,
      generationWarning: null,
    })
    return
  }

  try {
    const languageMode = await getLanguageMode({
      userId: lookup.user_id,
      targetLanguage: lookup.target_language,
      usersRepository: deps.usersRepository,
      targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    })
    if (!languageMode.nativeLanguage) {
      await deps.practiceExercisesRepository.markFailed({
        id: slot.id,
        token: claim.token,
        warning: 'native language pref missing',
      })
      return
    }

    const passArgs = {
      term: toTermInput(lookup),
      targetLanguage: lookup.target_language,
      nativeLanguage: languageMode.nativeLanguage,
      cefrLevel: 'B1',
      hideTranslationFields: languageMode.hideTranslationFields,
      allowL1Notes: languageMode.allowL1Notes,
    }

    const rejections: string[] = []
    for (let attempt = 1; attempt <= MAX_GEN_ATTEMPTS; attempt++) {
      let generated: GeneratedExercise
      try {
        generated = await generateExercisePass({ type: slot.exercise_type as GeneratableExerciseType, ...passArgs })
      } catch (e) {
        rejections.push(`attempt ${attempt} generate: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      const verdict = await verifyExercisePass({ exercise: generated, ...passArgs })
      if (verdict.pass) {
        await deps.practiceExercisesRepository.markReady({
          id: slot.id,
          token: claim.token,
          payload: generated.payload,
          gateEligible: true,
          generationWarning: rejections.length > 0 ? `passed on attempt ${attempt}` : null,
        })
        return
      }
      rejections.push(`attempt ${attempt} verify: ${verdict.reasons.join('; ') || 'no reason given'}`)
    }
    await deps.practiceExercisesRepository.markFailed({
      id: slot.id,
      token: claim.token,
      warning: `rejected after ${MAX_GEN_ATTEMPTS} attempts: ${rejections.join(' | ')}`,
    })
  } catch (e) {
    await deps.practiceExercisesRepository.markFailed({
      id: slot.id,
      token: claim.token,
      warning: e instanceof Error ? e.message : String(e),
    })
  }
}

// Top up the (term, pool) bank: reserve any missing slots and kick off
// generation for each in a detached promise (the reading pre-gen pattern).
// Idempotent and cheap when the bank is already full — reserveSlots returns
// nothing and no LLM work starts.
export const ensureExerciseBank = async (params: {
  lookup: DbUserLookup
  pool: PracticePool
  deps: ExerciseBankDependencies
}): Promise<void> => {
  const { lookup, pool, deps } = params
  const fresh = await deps.practiceExercisesRepository.reserveSlots({
    userId: lookup.user_id,
    userLookupId: lookup.id,
    targetLanguage: lookup.target_language,
    pool,
    types: requiredExerciseTypes(pool),
  })
  for (const slot of fresh) {
    void runExerciseGenerationForSlot({ slot, lookup, deps }).catch((err) =>
      console.error('exercise generation threw', { slotId: slot.id, err })
    )
  }
}

// Fire-and-forget warmer for rating triggers (again/hard in either render
// mode) so post-session Strengthen exercises are ready when the session ends.
export const warmExerciseBank = (params: {
  lookup: DbUserLookup
  pool: PracticePool
  deps: ExerciseBankDependencies
}): void => {
  void ensureExerciseBank(params).catch((err) =>
    console.error('exercise bank warm-up threw', { userLookupId: params.lookup.id, err })
  )
}

export type StrengthenExerciseEntry = {
  exerciseId: string | null
  userLookupId: string
  // The facet pool this exercise drills. A warm-up serves a MIXED queue
  // (recognition + production), and both entries of a both-skills term share one
  // userLookupId — so the client must key its placeholder merge on
  // (pool, userLookupId), not userLookupId alone, or polling would overwrite the
  // wrong pool's placeholder.
  pool: PracticePool
  headword: string
  sense: string
  track: 'gate' | 'bonus'
  status: 'ready' | 'generating' | 'failed'
  exerciseType: ExerciseType | null
  // Stripped payload — answer fields (answer/answerIndex/acceptedForms) never
  // leave the server. Null while generating.
  payload: Record<string, unknown> | null
}

// Strip the answer truth out of a stored payload before serving.
const stripExercisePayload = (
  exerciseType: ExerciseType,
  payload: Record<string, unknown>
): Record<string, unknown> => {
  switch (exerciseType) {
    case 'mc_cloze':
      return {
        type: 'mc_cloze',
        sentence: payload.sentence,
        blankStart: payload.blankStart,
        blankEnd: payload.blankEnd,
        options: payload.options,
      }
    case 'mc_comprehension':
      return {
        type: 'mc_comprehension',
        sentence: payload.sentence,
        prompt: payload.prompt,
        options: payload.options,
      }
    case 'production_cloze':
      return {
        type: 'production_cloze',
        sentence: payload.sentence,
        blankStart: payload.blankStart,
        blankEnd: payload.blankEnd,
        hint: payload.hint ?? null,
      }
    case 'use_in_sentence':
      return {
        type: 'use_in_sentence',
        prompt: payload.prompt,
        term: payload.term,
      }
  }
}

// A no-exercise entry — either still cooking ('generating') or terminally
// exhausted ('failed'). The client renders a placeholder; 'failed' tells it to
// stop waiting and offer a skip.
const placeholderEntry = (
  lookup: DbUserLookup,
  pool: PracticePool,
  track: 'gate' | 'bonus',
  status: 'generating' | 'failed'
): StrengthenExerciseEntry => ({
  exerciseId: null,
  userLookupId: lookup.id,
  pool,
  headword: lookup.headword,
  sense: lookup.sense ?? '',
  track,
  status,
  exerciseType: null,
  payload: null,
})

const toEntry = (
  lookup: DbUserLookup,
  pool: PracticePool,
  track: 'gate' | 'bonus',
  exercise: DbPracticeExercise | null
): StrengthenExerciseEntry => {
  if (!exercise || exercise.payload == null) {
    return placeholderEntry(lookup, pool, track, 'generating')
  }
  return {
    exerciseId: exercise.id,
    userLookupId: lookup.id,
    pool,
    headword: lookup.headword,
    sense: lookup.sense ?? '',
    track,
    status: 'ready',
    exerciseType: exercise.exercise_type,
    payload: stripExercisePayload(exercise.exercise_type, exercise.payload as Record<string, unknown>),
  }
}

// Build the Strengthen session: one gate exercise per parked term (rehab
// track), plus one bonus exercise per this-session again/hard term. Terms with
// nothing ready get a 'generating' placeholder (and a bank top-up kick) rather
// than blocking the session start.
export const getStrengthenExercises = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  sessionHardUserLookupIds: string[]
  // When set, the gate track is scoped to these parked terms only (warm-up
  // serves one session's onboarding terms, not every parked leech).
  restrictToUserLookupIds?: string[]
  // Which parked population to serve on the gate track: 'leech' for Strengthen,
  // 'onboarding' for Warm-up, omitted for both (the bonus track is unaffected).
  parkedOrigin?: 'onboarding' | 'leech'
  deps: ExerciseBankDependencies
}): Promise<StrengthenExerciseEntry[]> => {
  const { userId, targetLanguage, pool, restrictToUserLookupIds, parkedOrigin, deps } = params

  const parked = await deps.userLookupsRepository.listParkedTerms({
    userId,
    targetLanguage,
    pool,
    restrictToUserLookupIds,
    parkedOrigin,
  })
  const parkedIds = new Set(parked.map((row) => row.id))

  // sessionHardUserLookupIds is client-supplied: re-validate ownership and
  // scope server-side, silently dropping anything that doesn't check out.
  // Parked terms never appear in the review queue, so the hard set is
  // non-leech by construction — but drop overlaps defensively anyway.
  const hardIds = Array.from(new Set(params.sessionHardUserLookupIds))
  const candidateLookups = (
    await Promise.all(hardIds.map((id) => deps.userLookupsRepository.findByIdForUser(id, userId)))
  ).filter(
    (row): row is DbUserLookup =>
      row != null && row.target_language === targetLanguage && row.count > 0 && !parkedIds.has(row.id)
  )
  // Production-pool membership is now the citation meaning_production facet
  // being ENABLED (replaces the dropped learning_mode column). Re-validate each
  // candidate's production facet; a missing or disabled facet drops it.
  let hardLookups: DbUserLookup[]
  if (pool === 'production') {
    const enabledFlags = await Promise.all(
      candidateLookups.map(async (row) => {
        const facet = await deps.studyFacetsRepository.getFacet({
          userLookupId: row.id,
          skill: 'meaning_production',
          targetForm: CITATION_FORM,
        })
        return facet != null && facet.disabled_at === null
      })
    )
    hardLookups = candidateLookups.filter((_, i) => enabledFlags[i])
  } else {
    hardLookups = candidateLookups
  }

  const entries: StrengthenExerciseEntry[] = []

  for (const lookup of parked) {
    // Tier-typed gate: the exercise type escalates with the term's rehab day
    // count (the pool's matching ladder). But fall back to ANY ready
    // gate-eligible exercise when the tier's preferred type isn't ready — a term
    // whose required type can't be generated (the verifier keeps refusing it, as
    // for a malformed headword) must still progress. Graduation is gated on N
    // distinct days, not a strict type sequence, so any gate exercise counts.
    const tierType = gateTypeForTier(pool, rehabCorrectDaysFor(lookup))
    const exercise =
      (await deps.practiceExercisesRepository.selectNextExercise({
        userLookupId: lookup.id,
        pool,
        gateEligible: true,
        type: tierType,
      })) ??
      (await deps.practiceExercisesRepository.selectNextExercise({
        userLookupId: lookup.id,
        pool,
        gateEligible: true,
      }))
    if (exercise) {
      entries.push(toEntry(lookup, pool, 'gate', exercise))
      continue
    }
    // Nothing ready. Distinguish "still cooking" from "terminally exhausted"
    // (every candidate gate slot failed) so the client shows a clear failed
    // state instead of an endless hourglass — and so we stop re-reserving
    // doomed slots for a term the LLM can't build an exercise for.
    const gateTypes = gateCapableTypes(pool)
    const bank = await deps.practiceExercisesRepository.countGateBankSlots({
      userLookupId: lookup.id,
      pool,
      types: gateTypes,
    })
    if (bank.inflight > 0) {
      entries.push(placeholderEntry(lookup, pool, 'gate', 'generating'))
    } else if (bank.failedTypes >= gateTypes.length) {
      entries.push(placeholderEntry(lookup, pool, 'gate', 'failed'))
    } else {
      void ensureExerciseBank({ lookup, pool, deps })
      entries.push(placeholderEntry(lookup, pool, 'gate', 'generating'))
    }
  }

  const bonusByLookupId = new Map(
    (
      await deps.practiceExercisesRepository.listBonusForTerms({
        userId,
        pool,
        userLookupIds: hardLookups.map((row) => row.id),
      })
    ).map((exercise) => [exercise.user_lookup_id, exercise])
  )
  for (const lookup of hardLookups) {
    const exercise = bonusByLookupId.get(lookup.id) ?? null
    if (!exercise) void ensureExerciseBank({ lookup, pool, deps })
    entries.push(toEntry(lookup, pool, 'bonus', exercise))
  }

  return entries
}
