import { describe, expect, test } from 'vitest'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'
import { ImportBatchesRepository } from '../import-batches/import-batches-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { PracticeRatingEventsRepository } from './practice-rating-events-repository'

describe('practice-rating-events getting-started predicate', () => {
  test('excludes lesson-import events and counts a live practice rating', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await UserLookupsRepository().findOrCreate({
      userId,
      targetLanguage: 'es',
      headword: 'gato',
      sense: 'animal',
    })
    const repository = PracticeRatingEventsRepository()
    const unique = __generateUniqueId('lesson')
    const batch = await ImportBatchesRepository().insertBatch({
      userId,
      targetLanguage: 'es',
      teacherProfileId: null,
      sourceTitle: 'Lesson notes',
      rawText: unique,
      inputHash: unique,
    })
    expect(batch).not.toBeNull()

    const insertEvent = async (importBatchId: string | null) =>
      repository.insert({
        userId,
        userLookupId: lookup.id,
        targetLanguage: 'es',
        pool: 'recognition',
        skill: 'meaning_recognition',
        targetForm: '',
        rating: 'again',
        wasExplicit: importBatchId === null,
        wasIntroduction: false,
        causedParking: false,
        practiceTextId: null,
        importBatchId,
        headword: lookup.headword,
        sense: lookup.sense,
        prevSrsState: null,
        prevSrsDue: null,
        prevSrsStability: null,
        prevSrsDifficulty: null,
        prevSrsLastReview: null,
        prevSrsReps: null,
        prevSrsLapses: null,
        prevSrsLearningSteps: null,
      })

    expect(await repository.hasLiveEvent(userId)).toBe(false)
    await insertEvent(batch!.id)
    expect(await repository.hasLiveEvent(userId)).toBe(false)

    await insertEvent(null)
    expect(await repository.hasLiveEvent(userId)).toBe(true)
  })
})
