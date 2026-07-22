import { describe, expect, test } from 'vitest'
import { sql } from '../postgres-client'
import { shiftPracticeTimestamps } from './shift-practice-timestamps'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

// Dev time-travel against a real DB: shifting the data backward must be
// exactly equivalent to the server clock advancing — timestamptz columns move
// by whole days (time of day preserved), date columns stay dates, and a
// userId scope leaves other users' rows untouched.
describe('shiftPracticeTimestamps', () => {
  const userLookupsRepository = UserLookupsRepository()

  const createParkedFacet = async (userId: string, headword: string) => {
    const lookup = await userLookupsRepository.findOrCreate({ userId, targetLanguage: 'es', headword, sense: 'x' })
    const rows = await sql<{ id: string }[]>`
      INSERT INTO public.study_facets
        (user_lookup_id, user_id, target_language, skill, target_form, data_status,
         srs_due, introduced_at, leech_parked_at, leech_rehab_last_correct_on)
      VALUES (${lookup.id}, ${userId}, 'es', 'meaning_recognition', '', 'ready',
              NOW(), NOW(), NOW(), CURRENT_DATE)
      RETURNING id
    `
    return rows[0].id
  }

  const readFacetTimes = async (facetId: string) => {
    const rows = await sql<{ srs_due: Date; introduced_at: Date; leech_rehab_last_correct_on: string }[]>`
      SELECT srs_due, introduced_at, leech_rehab_last_correct_on::text FROM public.study_facets WHERE id = ${facetId}
    `
    return rows[0]
  }

  const readKnownMarkTime = async (userId: string): Promise<Date> => {
    const rows = await sql<{ marked_at: Date }[]>`
      SELECT marked_at FROM public.known_lemmas WHERE user_id = ${userId}
    `
    return rows[0].marked_at
  }

  test('shifts timestamptz columns back by whole days and date columns to earlier dates', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const facetId = await createParkedFacet(userId, 'correr')
    await sql`
      INSERT INTO public.known_lemmas (user_id, target_language, lemma, source, source_id, sweep_batch_id)
      VALUES (${userId}, 'es', 'sabido', 'bulk_text', NULL, NULL)
    `
    const before = await readFacetTimes(facetId)
    const knownBefore = await readKnownMarkTime(userId)

    const results = await shiftPracticeTimestamps(sql, { days: 2, userId })

    const after = await readFacetTimes(facetId)
    const dayMs = 24 * 60 * 60 * 1000
    expect(before.srs_due.getTime() - after.srs_due.getTime()).toBe(2 * dayMs)
    expect(before.introduced_at.getTime() - after.introduced_at.getTime()).toBe(2 * dayMs)

    // known_lemmas.marked_at feeds the activity chart/streak — it must travel too.
    const knownAfter = await readKnownMarkTime(userId)
    expect(knownBefore.getTime() - knownAfter.getTime()).toBe(2 * dayMs)
    expect(results.find((r) => r.table === 'known_lemmas')?.rowsShifted).toBe(1)

    // The rehab day-credit date (a DATE column) moves from today to two days
    // ago — exactly what lets `IS DISTINCT FROM CURRENT_DATE` grant a fresh
    // day credit without waiting a real day.
    const twoDaysAgo = await sql<{ expected: string }[]>`SELECT (CURRENT_DATE - 2)::text AS expected`
    expect(after.leech_rehab_last_correct_on).toBe(twoDaysAgo[0].expected)

    const facetsResult = results.find((r) => r.table === 'study_facets')
    expect(facetsResult?.rowsShifted).toBe(1)
  })

  // The unscoped (shift-everyone) variant is deliberately not exercised: it
  // would rewrite every user's practice timestamps and corrupt the SRS
  // assertions of tests running in parallel against the same database.
  test('a userId scope shifts that user and leaves other users untouched', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { id: otherUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const facetId = await createParkedFacet(userId, 'correr')
    const otherFacetId = await createParkedFacet(otherUserId, 'andar')
    const before = await readFacetTimes(facetId)
    const otherBefore = await readFacetTimes(otherFacetId)

    await shiftPracticeTimestamps(sql, { days: 1, userId })

    const dayMs = 24 * 60 * 60 * 1000
    const after = await readFacetTimes(facetId)
    const otherAfterScoped = await readFacetTimes(otherFacetId)
    expect(before.srs_due.getTime() - after.srs_due.getTime()).toBe(dayMs)
    expect(otherAfterScoped.srs_due.getTime()).toBe(otherBefore.srs_due.getTime())
  })
})
