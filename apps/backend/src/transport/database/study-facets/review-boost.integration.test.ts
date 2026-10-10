import { describe, expect, test } from 'vitest'
import { StudyFacetsRepository } from './study-facets-repository'
import { UserLookupsRepository } from '../user-lookups/user-lookups-repository'
import { beginTx, sql } from '../postgres-client'
import { bridgeRecognitionFromProduction } from '../../../service/practice/recognition-bridge'
import type { WithTransaction } from '../../../service/practice/rate-term'
import { __createUserInSupabaseAndGetHisIdAndToken } from '../../../test/test-utils'

const DAY_MS = 24 * 60 * 60 * 1000

// "Review tomorrow" (review-boost-sql.ts): the boost write, its eligibility,
// the derived boostActive, its undo, its survival across rating undos, and its
// priority in the due-review queue.
describe('review boost', () => {
  const repo = StudyFacetsRepository()
  const userLookupsRepository = UserLookupsRepository()
  const skill = 'meaning_recognition' as const

  // A kept term whose recognition card is in review, due in `dueInDays` days
  // and last reviewed 5 days ago.
  const reviewTerm = async (userId: string, headword: string, dueInDays: number) => {
    const lookup = await userLookupsRepository.findOrCreate({ userId, targetLanguage: 'es', headword, sense: 'x' })
    await sql`UPDATE public.user_lookups SET count = 1 WHERE id = ${lookup.id}`
    await repo.ensureCitationFacet(lookup.id)
    await sql`
      UPDATE public.study_facets
      SET srs_state = 'review', srs_due = (CURRENT_DATE + ${dueInDays}::int)::timestamptz + INTERVAL '10 hours',
          srs_stability = 20, srs_difficulty = 5, srs_reps = 3, srs_last_review = NOW() - INTERVAL '5 days',
          introduced_at = NOW() - INTERVAL '30 days'
      WHERE user_lookup_id = ${lookup.id}
    `
    return lookup.id
  }

  const facet = async (userLookupId: string) => {
    const rows = (await sql`
      SELECT srs_due, boosted_at, boost_prev_due,
        (srs_due::date - CURRENT_DATE) AS due_in_days,
        (boosted_at IS NOT NULL AND boosted_at > COALESCE(srs_last_review, '-infinity'::timestamptz)) AS boost_active
      FROM public.study_facets WHERE user_lookup_id = ${userLookupId} AND skill = ${skill} AND target_form = ''
    `) as Array<{
      srs_due: Date
      boosted_at: Date | null
      boost_prev_due: Date | null
      due_in_days: number
      boost_active: boolean
    }>
    return rows[0]!
  }

  // boosted_at is Postgres NOW() (microseconds) while a review time is a JS
  // Date (milliseconds): a review within the same millisecond would truncate
  // to before the boost. Real reviews come a day later, so space the two apart.
  const ageBoost = (userLookupId: string) =>
    sql`UPDATE public.study_facets SET boosted_at = boosted_at - INTERVAL '1 second' WHERE user_lookup_id = ${userLookupId}`

  const rate = (userLookupId: string, dueInDays: number) =>
    repo.applyFsrsResultForFacet({
      userLookupId,
      skill,
      targetForm: '',
      state: 'review',
      due: new Date(Date.now() + dueInDays * DAY_MS),
      stability: 30,
      difficulty: 5,
      lastReview: new Date(),
      reps: 4,
      lapses: 0,
      learningSteps: 0,
    })

  test('pulls a far-due review card to tomorrow and remembers the due date it replaced', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await reviewTerm(userId, 'lejos', 23)
    const before = await facet(id)

    expect(await repo.boostFacet({ userId, userLookupId: id, skill })).not.toBeNull()
    const after = await facet(id)
    expect(after.due_in_days).toBe(1)
    expect(after.boost_active).toBe(true)
    expect(after.boost_prev_due).toEqual(before.srs_due)

    // A repeat is a no-op: the card is now due tomorrow.
    expect(await repo.boostFacet({ userId, userLookupId: id, skill })).toBeNull()
  })

  test('refuses cards with nothing to pull forward or outside the queue', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const soon = await reviewTerm(userId, 'pronto', 1)
    const learning = await reviewTerm(userId, 'aprender', 20)
    await sql`UPDATE public.study_facets SET srs_state = 'learning' WHERE user_lookup_id = ${learning}`
    const parked = await reviewTerm(userId, 'aparcado', 20)
    await sql`UPDATE public.study_facets SET leech_parked_at = NOW() WHERE user_lookup_id = ${parked}`
    const disabled = await reviewTerm(userId, 'apagado', 20)
    await sql`UPDATE public.study_facets SET disabled_at = NOW() WHERE user_lookup_id = ${disabled}`
    const notReady = await reviewTerm(userId, 'pendiente', 20)
    await sql`UPDATE public.study_facets SET data_status = 'pending_data' WHERE user_lookup_id = ${notReady}`
    const unkept = await reviewTerm(userId, 'suelto', 20)
    await sql`UPDATE public.user_lookups SET count = 0 WHERE id = ${unkept}`
    const deleted = await reviewTerm(userId, 'borrado', 20)
    await sql`UPDATE public.user_lookups SET deleted_at = NOW() WHERE id = ${deleted}`
    const { id: otherUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const foreign = await reviewTerm(otherUserId, 'ajeno', 20)

    for (const id of [soon, learning, parked, disabled, notReady, unkept, deleted, foreign]) {
      expect(await repo.boostFacet({ userId, userLookupId: id, skill })).toBeNull()
      expect((await facet(id)).boosted_at).toBeNull()
    }
  })

  test('the next review ends the boost, and its undo is then a no-op', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await reviewTerm(userId, 'revisar', 23)
    await repo.boostFacet({ userId, userLookupId: id, skill })
    await ageBoost(id)

    await rate(id, 40)
    expect((await facet(id)).boost_active).toBe(false)
    expect(await repo.unboostFacet({ userId, userLookupId: id, skill })).toBe(false)
    expect((await facet(id)).due_in_days).toBeGreaterThan(30)
  })

  test('the recognition bridge (a credit without a rating event) ends the boost too', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await reviewTerm(userId, 'puente', 23)
    await repo.boostFacet({ userId, userLookupId: id, skill })
    await ageBoost(id)

    const lookup = (await userLookupsRepository.findByIdForUser(id, userId))!
    const withTransaction: WithTransaction = (fn) => beginTx(fn) as ReturnType<typeof fn>
    await bridgeRecognitionFromProduction({ lookup, deps: { studyFacetsRepository: repo, withTransaction } })
    expect((await facet(id)).boost_active).toBe(false)
  })

  test('unboost restores the replaced due date while the boost is untouched', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await reviewTerm(userId, 'deshacer', 23)
    const before = await facet(id)
    await repo.boostFacet({ userId, userLookupId: id, skill })

    expect(await repo.unboostFacet({ userId, userLookupId: id, skill })).toBe(true)
    const after = await facet(id)
    expect(after.srs_due).toEqual(before.srs_due)
    expect(after.boosted_at).toBeNull()
    expect(await repo.unboostFacet({ userId, userLookupId: id, skill })).toBe(false)
  })

  // due in 10d → a rating moves it to 30d → boost → undo the rating → unboost:
  // the boost survives the rating undo, rebased on the restored schedule, so
  // the unboost lands on 10d, not 30d.
  test('a boost survives an undo of an earlier rating, rebased on the restored schedule', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await reviewTerm(userId, 'secuencia', 10)
    const original = (
      await sql`
      SELECT srs_state, srs_due, srs_stability, srs_difficulty, srs_last_review, srs_reps, srs_lapses, srs_learning_steps
      FROM public.study_facets WHERE user_lookup_id = ${id}
    `
    )[0]!
    await rate(id, 30)
    await repo.boostFacet({ userId, userLookupId: id, skill })

    await repo.restoreSrsSnapshotForFacet({
      userLookupId: id,
      skill,
      targetForm: '',
      prevState: original.srs_state,
      prevDue: original.srs_due,
      prevStability: original.srs_stability,
      prevDifficulty: original.srs_difficulty,
      prevLastReview: original.srs_last_review,
      prevReps: original.srs_reps,
      prevLapses: original.srs_lapses,
      prevLearningSteps: original.srs_learning_steps,
      wasIntroduction: false,
      causedParking: false,
    })
    const restored = await facet(id)
    expect(restored.boost_active).toBe(true)
    expect(restored.due_in_days).toBe(1)
    expect(restored.boost_prev_due).toEqual(original.srs_due)

    expect(await repo.unboostFacet({ userId, userLookupId: id, skill })).toBe(true)
    expect((await facet(id)).srs_due).toEqual(original.srs_due)
  })

  test('a boosted card takes a review-budget slot ahead of overdue backlog', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const overdue = await reviewTerm(userId, 'atrasado', -3)
    const boosted = await reviewTerm(userId, 'impulsado', 20)
    await repo.boostFacet({ userId, userLookupId: boosted, skill })
    // The boost's day: due tomorrow, so step the boost back a day to make it due now.
    await sql`
      UPDATE public.study_facets
      SET srs_due = srs_due - INTERVAL '1 day', boosted_at = boosted_at - INTERVAL '1 day'
      WHERE user_lookup_id = ${boosted}
    `

    const rows = await userLookupsRepository.listDueReviewTerms({
      userId,
      targetLanguage: 'es',
      pool: 'recognition',
      maxReviewTerms: 1,
      maxLearningTerms: 10,
    })
    expect(rows.map((r) => [r.id, r.boost_active])).toEqual([[boosted, true]])
    expect(overdue).not.toBe(boosted)
  })
})
