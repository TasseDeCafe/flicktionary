import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { UserLookupsRepository, type ChunkRow, type ChunksCursor, type VocabStage } from './user-lookups-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __removeAllAuthUsersFromSupabase } from '../../../test/test-utils'

// The vocabulary Stage filter against a real DB: the six vocabStageClauseSql
// buckets must PARTITION a language's kept terms (the practice landing's
// segmented bar sums them to totalKept), missing/disabled facets must land in
// `unseen` (three-valued-logic trap), and the up_next branch must page in
// newTermOrderSql order across ties and NULL zipf values.
describe('listChunksForLanguage: stage filters', () => {
  const userLookupsRepository = UserLookupsRepository()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })
  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

  // A kept term with fully controlled ordering/decay signals. Encounter
  // signals default to "fresh single save" (tier 2, not decayed).
  const makeTerm = async (params: {
    userId: string
    headword: string
    sense?: string
    lastEncounteredAt?: string | null
    encounterCount?: number
    zipf?: number | null
    createdAt?: string
  }) => {
    const lookup = await userLookupsRepository.findOrCreate({
      userId: params.userId,
      targetLanguage: 'es',
      headword: params.headword,
      sense: params.sense ?? 'x',
    })
    await sql`
      UPDATE public.user_lookups
      SET count = 1,
          encounter_count = ${params.encounterCount ?? 1},
          last_encountered_at = ${params.lastEncounteredAt === undefined ? daysAgo(5) : params.lastEncounteredAt},
          zipf_estimate = ${params.zipf ?? null},
          created_at = ${params.createdAt ?? daysAgo(10)}
      WHERE id = ${lookup.id}
    `
    return lookup
  }

  const insertRecognitionFacet = async (params: {
    userLookupId: string
    userId: string
    srsState: 'new' | 'learning' | 'review' | 'relearning' | null
    leechParkedAt?: string | null
    disabledAt?: string | null
    dataStatus?: 'ready' | 'pending_data'
  }) => {
    await sql`
      INSERT INTO public.study_facets
        (user_lookup_id, user_id, target_language, skill, target_form,
         srs_state, leech_parked_at, disabled_at, data_status)
      VALUES (${params.userLookupId}, ${params.userId}, 'es', 'meaning_recognition', '',
              ${params.srsState}, ${params.leechParkedAt ?? null}, ${params.disabledAt ?? null},
              ${params.dataStatus ?? 'ready'})
    `
  }

  const listStage = async (userId: string, stage: VocabStage | 'due' | null): Promise<ChunkRow[]> => {
    const { rows } = await userLookupsRepository.listChunksForLanguage({
      userId,
      targetLanguage: 'es',
      sort: 'recent',
      cursor: null,
      limit: 50,
      q: null,
      status: stage,
    })
    return rows
  }

  test('the six stages partition the kept terms, with missing/disabled/decayed facets in unseen', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()

    const upNext = await makeTerm({ userId, headword: 'up-next' })
    // pending_data on purpose: up_next mirrors parking eligibility, which has
    // no data_status check — a not-yet-enriched term still gets introduced.
    await insertRecognitionFacet({ userLookupId: upNext.id, userId, srsState: null, dataStatus: 'pending_data' })

    const warmingUp = await makeTerm({ userId, headword: 'warming-up' })
    await insertRecognitionFacet({ userLookupId: warmingUp.id, userId, srsState: null, leechParkedAt: daysAgo(1) })

    const learning = await makeTerm({ userId, headword: 'learning' })
    await insertRecognitionFacet({ userLookupId: learning.id, userId, srsState: 'learning' })

    const review = await makeTerm({ userId, headword: 'review' })
    await insertRecognitionFacet({ userLookupId: review.id, userId, srsState: 'review' })

    const strengthen = await makeTerm({ userId, headword: 'strengthen' })
    await insertRecognitionFacet({ userLookupId: strengthen.id, userId, srsState: 'review', leechParkedAt: daysAgo(1) })

    // The three unseen shapes: no facet row at all, a disabled facet, and a
    // decayed never-studied term. (last_encountered_at is NOT NULL by schema —
    // there is no "never encountered" shape.)
    const unseenNoFacet = await makeTerm({ userId, headword: 'unseen-no-facet' })
    const unseenDisabled = await makeTerm({ userId, headword: 'unseen-disabled' })
    await insertRecognitionFacet({ userLookupId: unseenDisabled.id, userId, srsState: null, disabledAt: daysAgo(1) })
    const unseenDecayed = await makeTerm({ userId, headword: 'unseen-decayed', lastEncounteredAt: daysAgo(120) })
    await insertRecognitionFacet({ userLookupId: unseenDecayed.id, userId, srsState: null })

    const expectStage = async (stage: VocabStage, expectedIds: string[]) => {
      const rows = await listStage(userId, stage)
      expect(new Set(rows.map((r) => r.id)), `stage ${stage}`).toEqual(new Set(expectedIds))
    }

    await expectStage('up_next', [upNext.id])
    await expectStage('warming_up', [warmingUp.id])
    await expectStage('learning', [learning.id])
    await expectStage('review', [review.id])
    await expectStage('strengthen', [strengthen.id])
    await expectStage('unseen', [unseenNoFacet.id, unseenDisabled.id, unseenDecayed.id])

    // Partition property: every kept term lands in exactly one stage.
    const all = await listStage(userId, null)
    const stages: VocabStage[] = ['up_next', 'warming_up', 'learning', 'review', 'strengthen', 'unseen']
    const perStage = await Promise.all(stages.map((stage) => listStage(userId, stage)))
    const union = perStage.flat().map((r) => r.id)
    expect(union.length).toBe(all.length)
    expect(new Set(union)).toEqual(new Set(all.map((r) => r.id)))
  })

  test("'new' srs_state counts as learning (introduced, awaiting first review), not up_next", async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const term = await makeTerm({ userId, headword: 'new-state' })
    await insertRecognitionFacet({ userLookupId: term.id, userId, srsState: 'new' })

    expect((await listStage(userId, 'learning')).map((r) => r.id)).toEqual([term.id])
    expect(await listStage(userId, 'up_next')).toEqual([])
  })

  test('up_next pages in introduction order across tiers, NULL zipf, and tied keys', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const sameCreatedAt = daysAgo(10)

    // Expected newTermOrderSql order:
    //   tier 1 (encounter_count >= 2): zipf DESC, NULLS LAST
    //   tier 2 (fresh single save):    tie on (zipf, created_at) -> headword ASC
    //   tier 3 (older, not decayed):   last
    const a = await makeTerm({ userId, headword: 'aaa', encounterCount: 3, zipf: 5 })
    const b = await makeTerm({ userId, headword: 'bbb', encounterCount: 2, zipf: null })
    const c = await makeTerm({ userId, headword: 'ccc', zipf: 6, createdAt: sameCreatedAt })
    const d = await makeTerm({ userId, headword: 'ddd', zipf: 6, createdAt: sameCreatedAt })
    const e = await makeTerm({ userId, headword: 'eee', zipf: 3 })
    const f = await makeTerm({ userId, headword: 'fff', lastEncounteredAt: daysAgo(30), zipf: 7 })
    const expectedOrder = [a.id, b.id, c.id, d.id, e.id, f.id]
    for (const term of [a, b, c, d, e, f]) {
      await insertRecognitionFacet({ userLookupId: term.id, userId, srsState: null })
    }

    const singleShot = await listStage(userId, 'up_next')
    expect(singleShot.map((r) => r.id)).toEqual(expectedOrder)

    // Page size 3 puts a page boundary exactly between the tied rows c and d:
    // the cursor must resume INTO the tie, not skip or repeat it.
    const paged: string[] = []
    let cursor: ChunksCursor | null = null
    let pages = 0
    do {
      const result = await userLookupsRepository.listChunksForLanguage({
        userId,
        targetLanguage: 'es',
        sort: 'recent',
        cursor,
        limit: 3,
        q: null,
        status: 'up_next',
      })
      paged.push(...result.rows.map((r) => r.id))
      cursor = result.nextCursor
      pages += 1
    } while (cursor !== null && pages < 10)

    expect(paged).toEqual(expectedOrder)
    expect(pages).toBe(2)
  })
})
