import { describe, expect, test } from 'vitest'
import { sql } from '../postgres-client'
import { PracticeExercisesRepository } from './practice-exercises-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'

const repo = PracticeExercisesRepository()

describe('practice-exercises recency', () => {
  test('getLastUsedAtByLanguage reads only answered exercises, per language', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookup = await UserLookupsRepository().findOrCreate({
      userId,
      targetLanguage: 'es',
      headword: __generateUniqueId('correr'),
      sense: 'x',
    })

    // One answered exercise (two days ago) and one still banked (used_at NULL).
    await sql`
      INSERT INTO public.practice_exercises
        (user_id, user_lookup_id, target_language, pool, exercise_type, status, used_at)
      VALUES
        (${userId}, ${lookup.id}, 'es', 'recognition', 'mc_cloze', 'used', NOW() - make_interval(days => 2)),
        (${userId}, ${lookup.id}, 'es', 'recognition', 'mc_cloze', 'ready', NULL)
    `

    const byLanguage = await repo.getLastUsedAtByLanguage(userId)
    const lastUsed = byLanguage.get('es')
    expect(lastUsed).toBeInstanceOf(Date)
    const dayMs = 24 * 60 * 60 * 1000
    expect(Math.abs(Date.now() - lastUsed!.getTime() - 2 * dayMs)).toBeLessThan(60 * 1000)
    expect(byLanguage.size).toBe(1)
  })
})
