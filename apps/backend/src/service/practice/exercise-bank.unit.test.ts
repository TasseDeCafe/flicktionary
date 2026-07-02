import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbPracticeExercise } from '../../transport/database/practice-exercises/practice-exercises-repository'
import {
  getHintExercise,
  getStrengthenExercises,
  warmHintExerciseBanksForFlashcards,
  type ExerciseBankDependencies,
} from './exercise-bank'

const userId = '00000000-0000-0000-0000-000000000001'
const lang = 'ru'
const lookupId = '00000000-0000-0000-0000-0000000000a1'

const parkedTerm = (overrides: Partial<DbUserLookupWithFacet> = {}): DbUserLookupWithFacet =>
  ({
    id: lookupId,
    user_id: userId,
    target_language: lang,
    headword: 'кадырман',
    sense: 'Kadyrov loyalist',
    skill: 'meaning_recognition',
    target_form: '',
    leech_rehab_correct_days: 0,
    ...overrides,
  }) as DbUserLookupWithFacet

const readyExercise = (type: DbPracticeExercise['exercise_type']): DbPracticeExercise =>
  ({
    id: '00000000-0000-0000-0000-0000000000b1',
    exercise_type: type,
    status: 'ready',
    payload: { type, sentence: 's', prompt: 'p', options: ['a', 'b', 'c', 'd'], answerIndex: 0 },
  }) as unknown as DbPracticeExercise

const createDeps = (params: {
  selectByType: (type: string | undefined) => DbPracticeExercise | null
  bank?: { inflight: number; failed: number; failedTypes: number }
  parked?: DbUserLookupWithFacet[]
}) => {
  const selectNextExercise = vi.fn().mockImplementation(async (p: { type?: string }) => params.selectByType(p.type))
  const countGateBankSlots = vi.fn().mockResolvedValue(params.bank ?? { inflight: 0, failed: 0, failedTypes: 0 })
  const reserveSlots = vi.fn().mockResolvedValue([])
  const listBonusForTerms = vi.fn().mockResolvedValue([])
  const listParkedTerms = vi.fn().mockResolvedValue(params.parked ?? [parkedTerm()])

  const deps = {
    practiceExercisesRepository: { selectNextExercise, countGateBankSlots, reserveSlots, listBonusForTerms },
    userLookupsRepository: { listParkedTerms },
    usersRepository: {},
    userTargetLanguagePrefsRepository: {},
    studyFacetsRepository: {},
  } as unknown as ExerciseBankDependencies

  return { deps, selectNextExercise, countGateBankSlots, reserveSlots, listParkedTerms }
}

const run = (deps: ExerciseBankDependencies, parkedOrigin?: 'onboarding' | 'leech') =>
  getStrengthenExercises({
    userId,
    targetLanguage: lang,
    pool: 'recognition',
    sessionHardUserLookupIds: [],
    parkedOrigin,
    deps,
  })

describe('getStrengthenExercises — gate ladder resilience', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('falls back to any ready gate exercise when the tier type is unavailable', async () => {
    // tier 0 wants mc_cloze (none ready), but a gate-eligible mc_comprehension
    // is ready — it must be served rather than blocking the term.
    const { deps } = createDeps({
      selectByType: (type) =>
        type === 'mc_cloze' ? null : type === undefined ? readyExercise('mc_comprehension') : null,
    })
    const entries = await run(deps)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.status).toBe('ready')
    expect(entries[0]!.exerciseType).toBe('mc_comprehension')
  })

  it('reports terminal failure (no ready, none in flight, some failed) without re-reserving', async () => {
    const { deps, reserveSlots } = createDeps({
      selectByType: () => null,
      bank: { inflight: 0, failed: 2, failedTypes: 2 },
    })
    const entries = await run(deps)
    expect(entries[0]!.status).toBe('failed')
    expect(entries[0]!.exerciseId).toBeNull()
    // Doomed slots are not re-reserved.
    expect(reserveSlots).not.toHaveBeenCalled()
  })

  it('shows generating while a slot is still in flight (does not re-reserve)', async () => {
    const { deps, reserveSlots } = createDeps({
      selectByType: () => null,
      bank: { inflight: 1, failed: 0, failedTypes: 0 },
    })
    const entries = await run(deps)
    expect(entries[0]!.status).toBe('generating')
    expect(reserveSlots).not.toHaveBeenCalled()
  })

  it('kicks generation for a cold bank (nothing ready, nothing in flight, nothing failed)', async () => {
    const { deps, reserveSlots } = createDeps({
      selectByType: () => null,
      bank: { inflight: 0, failed: 0, failedTypes: 0 },
    })
    const entries = await run(deps)
    expect(entries[0]!.status).toBe('generating')
    expect(reserveSlots).toHaveBeenCalledTimes(1)
  })

  it('re-reserves when only one gate type has failed and another type can still be generated', async () => {
    const { deps, reserveSlots } = createDeps({
      selectByType: () => null,
      bank: { inflight: 0, failed: 1, failedTypes: 1 },
    })
    const entries = await run(deps)
    expect(entries[0]!.status).toBe('generating')
    expect(reserveSlots).toHaveBeenCalledTimes(1)
  })

  it('threads parkedOrigin through to listParkedTerms (leech vs onboarding split)', async () => {
    const { deps, listParkedTerms } = createDeps({ selectByType: () => readyExercise('mc_cloze') })
    await run(deps, 'leech')
    expect(listParkedTerms).toHaveBeenCalledWith(expect.objectContaining({ parkedOrigin: 'leech' }))
  })
})

const createHintDeps = (params: {
  selectByType: (type: string | undefined) => DbPracticeExercise | null
  bank?: { inflight: number; failed: number; failedTypes: number }
  lookup?: DbUserLookupWithFacet | null
  slotCounts?: Array<{ user_lookup_id: string; ready: number; inflight: number; failed: number }>
}) => {
  const selectNextExercise = vi.fn().mockImplementation(async (p: { type?: string }) => params.selectByType(p.type))
  const countGateBankSlots = vi.fn().mockResolvedValue(params.bank ?? { inflight: 0, failed: 0, failedTypes: 0 })
  const reserveSlots = vi.fn().mockResolvedValue([])
  const countSlotsByTermForType = vi.fn().mockResolvedValue(params.slotCounts ?? [])
  const findByIdForUser = vi.fn().mockResolvedValue(params.lookup === undefined ? parkedTerm() : params.lookup)

  const deps = {
    practiceExercisesRepository: { selectNextExercise, countGateBankSlots, reserveSlots, countSlotsByTermForType },
    userLookupsRepository: { findByIdForUser },
    usersRepository: {},
    userTargetLanguagePrefsRepository: {},
    studyFacetsRepository: {},
  } as unknown as ExerciseBankDependencies

  return { deps, selectNextExercise, countGateBankSlots, reserveSlots, countSlotsByTermForType, findByIdForUser }
}

describe('getHintExercise', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('serves the recognition hint type (mc_comprehension) with a stripped payload', async () => {
    const { deps, selectNextExercise } = createHintDeps({
      selectByType: (type) => (type === 'mc_comprehension' ? readyExercise('mc_comprehension') : null),
    })
    const hint = await getHintExercise({ userId, userLookupId: lookupId, pool: 'recognition', deps })
    expect(selectNextExercise).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mc_comprehension', gateEligible: true })
    )
    expect(hint).not.toBeNull()
    expect(hint!.exerciseType).toBe('mc_comprehension')
    // The answer truth never leaves the server on a serve.
    expect(hint!.payload).not.toHaveProperty('answerIndex')
    expect(hint!.payload).toHaveProperty('options')
  })

  it('serves the production hint type (mc_cloze — mc_comprehension would leak the headword)', async () => {
    const { deps, selectNextExercise } = createHintDeps({
      selectByType: (type) => (type === 'mc_cloze' ? readyExercise('mc_cloze') : null),
    })
    const hint = await getHintExercise({ userId, userLookupId: lookupId, pool: 'production', deps })
    expect(selectNextExercise).toHaveBeenCalledWith(expect.objectContaining({ type: 'mc_cloze' }))
    expect(hint!.exerciseType).toBe('mc_cloze')
  })

  it('returns null on a cold bank and kicks a top-up of just the hint type', async () => {
    const { deps, reserveSlots } = createHintDeps({ selectByType: () => null })
    const hint = await getHintExercise({ userId, userLookupId: lookupId, pool: 'recognition', deps })
    expect(hint).toBeNull()
    expect(reserveSlots).toHaveBeenCalledWith(expect.objectContaining({ types: ['mc_comprehension'] }))
  })

  it('returns null WITHOUT a top-up when the hint type failed terminally', async () => {
    const { deps, reserveSlots } = createHintDeps({
      selectByType: () => null,
      bank: { inflight: 0, failed: 1, failedTypes: 1 },
    })
    const hint = await getHintExercise({ userId, userLookupId: lookupId, pool: 'recognition', deps })
    expect(hint).toBeNull()
    expect(reserveSlots).not.toHaveBeenCalled()
  })

  it('returns null WITHOUT a top-up while a slot is still cooking', async () => {
    const { deps, reserveSlots } = createHintDeps({
      selectByType: () => null,
      bank: { inflight: 1, failed: 0, failedTypes: 0 },
    })
    const hint = await getHintExercise({ userId, userLookupId: lookupId, pool: 'recognition', deps })
    expect(hint).toBeNull()
    expect(reserveSlots).not.toHaveBeenCalled()
  })

  it('returns null for an unknown or foreign term without touching the bank', async () => {
    const { deps, selectNextExercise } = createHintDeps({ selectByType: () => null, lookup: null })
    const hint = await getHintExercise({ userId, userLookupId: lookupId, pool: 'recognition', deps })
    expect(hint).toBeNull()
    expect(selectNextExercise).not.toHaveBeenCalled()
  })
})

describe('warmHintExerciseBanksForFlashcards', () => {
  beforeEach(() => vi.restoreAllMocks())

  const card = (overrides: Partial<DbUserLookupWithFacet> = {}): DbUserLookupWithFacet =>
    parkedTerm({ leech_parked_at: null, ...overrides })

  it('warms only terms with no hint-type slot at all', async () => {
    const covered = card({ id: '00000000-0000-0000-0000-0000000000c1' })
    const gap = card({ id: '00000000-0000-0000-0000-0000000000c2' })
    const { deps, reserveSlots } = createHintDeps({
      selectByType: () => null,
      slotCounts: [{ user_lookup_id: covered.id, ready: 1, inflight: 0, failed: 0 }],
    })
    await warmHintExerciseBanksForFlashcards({ cards: [covered, gap], deps })
    expect(reserveSlots).toHaveBeenCalledTimes(1)
    expect(reserveSlots).toHaveBeenCalledWith(
      expect.objectContaining({ userLookupId: gap.id, types: ['mc_comprehension'] })
    )
  })

  it('skips covered terms whether ready, inflight, or terminally failed', async () => {
    const ready = card({ id: '00000000-0000-0000-0000-0000000000c1' })
    const cooking = card({ id: '00000000-0000-0000-0000-0000000000c2' })
    const failed = card({ id: '00000000-0000-0000-0000-0000000000c3' })
    const { deps, reserveSlots } = createHintDeps({
      selectByType: () => null,
      slotCounts: [
        { user_lookup_id: ready.id, ready: 1, inflight: 0, failed: 0 },
        { user_lookup_id: cooking.id, ready: 0, inflight: 1, failed: 0 },
        { user_lookup_id: failed.id, ready: 0, inflight: 0, failed: 1 },
      ],
    })
    await warmHintExerciseBanksForFlashcards({ cards: [ready, cooking, failed], deps })
    expect(reserveSlots).not.toHaveBeenCalled()
  })

  it('warms per pool with the pool-matched hint type', async () => {
    const recognition = card({ id: '00000000-0000-0000-0000-0000000000c1', skill: 'meaning_recognition' })
    const production = card({ id: '00000000-0000-0000-0000-0000000000c2', skill: 'meaning_production' })
    const { deps, reserveSlots } = createHintDeps({ selectByType: () => null })
    await warmHintExerciseBanksForFlashcards({ cards: [recognition, production], deps })
    expect(reserveSlots).toHaveBeenCalledWith(
      expect.objectContaining({ userLookupId: recognition.id, pool: 'recognition', types: ['mc_comprehension'] })
    )
    expect(reserveSlots).toHaveBeenCalledWith(
      expect.objectContaining({ userLookupId: production.id, pool: 'production', types: ['mc_cloze'] })
    )
  })

  it('never warms pronunciation or form facets (the bank tests citation meaning only)', async () => {
    const pronunciation = card({ id: '00000000-0000-0000-0000-0000000000c1', skill: 'pronunciation' })
    const form = card({ id: '00000000-0000-0000-0000-0000000000c2', target_form: 'коты' })
    const { deps, reserveSlots, countSlotsByTermForType } = createHintDeps({ selectByType: () => null })
    await warmHintExerciseBanksForFlashcards({ cards: [pronunciation, form], deps })
    expect(countSlotsByTermForType).not.toHaveBeenCalled()
    expect(reserveSlots).not.toHaveBeenCalled()
  })
})
