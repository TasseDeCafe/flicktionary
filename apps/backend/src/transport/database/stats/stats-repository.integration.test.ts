import { describe, expect, test } from 'vitest'
import { sql } from '../postgres-client'
import { StatsRepository } from './stats-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { KnownLemmasRepository } from '../known-lemmas/known-lemmas-repository'
import { PracticeRatingEventsRepository } from '../practice-rating-events/practice-rating-events-repository'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'

const repo = StatsRepository()
const userLookupsRepository = UserLookupsRepository()

const insertIntroducedFacet = async (userId: string, headword: string, daysAgo: number) => {
  const lookup = await userLookupsRepository.findOrCreate({ userId, targetLanguage: 'es', headword, sense: 'x' })
  await sql`
    INSERT INTO public.study_facets
      (user_lookup_id, user_id, target_language, skill, target_form, data_status, introduced_at)
    VALUES (${lookup.id}, ${userId}, 'es', 'meaning_recognition', '', 'ready', NOW() - make_interval(days => ${daysAgo}))
  `
  return lookup
}

const dayAgo = async (daysAgo: number): Promise<string> => {
  const rows = (await sql`SELECT (CURRENT_DATE - ${daysAgo}::int)::text AS day`) as Array<{ day: string }>
  return rows[0].day
}

describe('stats repository', () => {
  test('per-day counts stay inside the window and group by language', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await sql`SELECT 1` // warm the client before sql.array (first-query OID quirk)

    await insertIntroducedFacet(userId, __generateUniqueId('hoy'), 0)
    await insertIntroducedFacet(userId, __generateUniqueId('ayer'), 1)
    // Outside a 14-day window — must not appear.
    await insertIntroducedFacet(userId, __generateUniqueId('viejo'), 20)

    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: 'es',
      lemmas: [__generateUniqueId('uno'), __generateUniqueId('dos')],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })

    const [today, yesterday] = [await dayAgo(0), await dayAgo(1)]
    const introduced = await repo.countIntroducedByDay(userId, 14)
    expect(introduced).toHaveLength(2)
    expect(introduced).toContainEqual({ day: today, targetLanguage: 'es', count: 1 })
    expect(introduced).toContainEqual({ day: yesterday, targetLanguage: 'es', count: 1 })

    const marked = await repo.countMarkedKnownByDay(userId, 14)
    expect(marked).toEqual([{ day: today, targetLanguage: 'es', count: 2 }])
  })

  test('active days unions all four sources and excludes reverted/imported ratings', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await sql`SELECT 1`

    // Day 0: known mark. Day 1: introduction. Day 2: exercise answer.
    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: 'es',
      lemmas: [__generateUniqueId('hoy')],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })
    const lookup = await insertIntroducedFacet(userId, __generateUniqueId('intro'), 1)
    await sql`
      INSERT INTO public.practice_exercises
        (user_id, user_lookup_id, target_language, pool, exercise_type, status, used_at)
      VALUES (${userId}, ${lookup.id}, 'es', 'recognition', 'mc_cloze', 'used', NOW() - make_interval(days => 2))
    `

    // Day 3: a rating that was undone — must NOT make the day active.
    const eventId = await PracticeRatingEventsRepository().insert({
      userId,
      userLookupId: lookup.id,
      targetLanguage: 'es',
      pool: 'recognition',
      skill: 'meaning_recognition',
      targetForm: '',
      rating: 'good',
      wasExplicit: true,
      wasIntroduction: false,
      causedParking: false,
      practiceTextId: null,
      importBatchId: null,
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
    await sql`
      UPDATE public.practice_rating_events
      SET rated_at = NOW() - make_interval(days => 3), reverted_at = NOW()
      WHERE id = ${eventId}
    `

    const activeDays = await repo.listActiveDays(userId)
    expect(activeDays).toEqual([await dayAgo(0), await dayAgo(1), await dayAgo(2)])

    const today = await repo.getCurrentDay()
    expect(today).toBe(await dayAgo(0))
  })
})
