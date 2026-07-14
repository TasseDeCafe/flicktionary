import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { PracticeExercisesRepository } from './practice-exercises-repository'

describe('practice-exercises getting-started predicate', () => {
  test('counts an exercise only after an answer consumes it', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await UserLookupsRepository().findOrCreate({
      userId,
      targetLanguage: 'es',
      headword: 'gato',
      sense: 'animal',
    })
    const repository = PracticeExercisesRepository()
    const [slot] = await repository.reserveSlots({
      userId,
      userLookupId: lookup.id,
      targetLanguage: 'es',
      pool: 'recognition',
      types: ['mc_comprehension'],
    })
    expect(slot).toBeDefined()
    const claim = await repository.claimGenerating(slot!.id)
    expect(claim).not.toBeNull()
    await repository.markReady({
      id: slot!.id,
      token: claim!.token,
      payload: { question: 'q', options: ['a', 'b'] },
      gateEligible: true,
      generationWarning: null,
    })

    expect(await repository.hasUsedExercise(userId)).toBe(false)
    await repository.consumeExercise(slot!.id)
    expect(await repository.hasUsedExercise(userId)).toBe(true)
  })
})
