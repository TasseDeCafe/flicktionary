import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbPracticeExercise } from '../../transport/database/practice-exercises/practice-exercises-repository'
import { getStrengthenExercises, type ExerciseBankDependencies } from './exercise-bank'

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
