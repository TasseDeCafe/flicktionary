import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { sql } from '../postgres-client'
import { shiftPracticeTimestamps } from './shift-practice-timestamps'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { __createUserInSupabaseAndGetHisIdAndToken, __removeAllAuthUsersFromSupabase } from '../../../test/test-utils'

// Dev time-travel against a real DB: shifting the data backward must be
// exactly equivalent to the server clock advancing — timestamptz columns move
// by whole days (time of day preserved), date columns stay dates, and a
// userId scope leaves other users' rows untouched.
describe('shiftPracticeTimestamps', () => {
  const userLookupsRepository = UserLookupsRepository()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })
  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

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

  test('shifts timestamptz columns back by whole days and date columns to earlier dates', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const facetId = await createParkedFacet(userId, 'correr')
    const before = await readFacetTimes(facetId)

    const results = await shiftPracticeTimestamps(sql, { days: 2, userId })

    const after = await readFacetTimes(facetId)
    const dayMs = 24 * 60 * 60 * 1000
    expect(before.srs_due.getTime() - after.srs_due.getTime()).toBe(2 * dayMs)
    expect(before.introduced_at.getTime() - after.introduced_at.getTime()).toBe(2 * dayMs)

    // The rehab day-credit date (a DATE column) moves from today to two days
    // ago — exactly what lets `IS DISTINCT FROM CURRENT_DATE` grant a fresh
    // day credit without waiting a real day.
    const twoDaysAgo = await sql<{ expected: string }[]>`SELECT (CURRENT_DATE - 2)::text AS expected`
    expect(after.leech_rehab_last_correct_on).toBe(twoDaysAgo[0].expected)

    const facetsResult = results.find((r) => r.table === 'study_facets')
    expect(facetsResult?.rowsShifted).toBe(1)
  })

  test('a userId scope leaves other users untouched; no scope shifts everyone', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { id: otherUserId } = await __createUserInSupabaseAndGetHisIdAndToken('other-time-shift@email.com')
    const facetId = await createParkedFacet(userId, 'correr')
    const otherFacetId = await createParkedFacet(otherUserId, 'andar')
    const otherBefore = await readFacetTimes(otherFacetId)

    await shiftPracticeTimestamps(sql, { days: 1, userId })

    const otherAfterScoped = await readFacetTimes(otherFacetId)
    expect(otherAfterScoped.srs_due.getTime()).toBe(otherBefore.srs_due.getTime())

    const scopedBefore = await readFacetTimes(facetId)
    await shiftPracticeTimestamps(sql, { days: 1 })

    const dayMs = 24 * 60 * 60 * 1000
    const afterGlobal = await readFacetTimes(facetId)
    const otherAfterGlobal = await readFacetTimes(otherFacetId)
    expect(scopedBefore.srs_due.getTime() - afterGlobal.srs_due.getTime()).toBe(dayMs)
    expect(otherBefore.srs_due.getTime() - otherAfterGlobal.srs_due.getTime()).toBe(dayMs)
  })
})
