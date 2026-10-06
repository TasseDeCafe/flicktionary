import { describe, expect, test } from 'vitest'
import { mergeUserLookups, type PlannedRow } from './merge-user-lookups'
import { UserLookupsRepository } from './user-lookups-repository'
import { StudySessionsRepository } from '../study-sessions/study-sessions-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'

const insertLookup = async (params: {
  userId: string
  headword: string
  sense: string
  createdDaysAgo: number
  encounterCount?: number
  grammar?: Record<string, unknown>
  translation?: string | null
}): Promise<PlannedRow> => {
  const [row] = (await sql`
    INSERT INTO public.user_lookups
      (user_id, target_language, headword, sense, count, encounter_count, grammar, translation, created_at)
    VALUES (${params.userId}, 'ru', ${params.headword}, ${params.sense}, 1, ${params.encounterCount ?? 1},
            ${sql.json((params.grammar ?? {}) as never)}, ${params.translation ?? null},
            NOW() - make_interval(days => ${params.createdDaysAgo}))
    RETURNING id, headword, sense
  `) as [PlannedRow]
  return row
}

const insertFacet = async (params: {
  userId: string
  userLookupId: string
  skill?: string
  introduced?: boolean
  reps?: number
}): Promise<string> => {
  const [row] = (await sql`
    INSERT INTO public.study_facets
      (user_lookup_id, user_id, target_language, skill, target_form, srs_state, srs_reps, introduced_at, data_status)
    VALUES (${params.userLookupId}, ${params.userId}, 'ru', ${params.skill ?? 'meaning_recognition'}, '',
            ${params.introduced ? 'review' : null}, ${params.reps ?? 0},
            ${params.introduced ? sql`NOW() - INTERVAL '3 days'` : null}, 'ready')
    RETURNING id
  `) as [{ id: string }]
  return row.id
}

const insertRatingEvent = async (userId: string, row: PlannedRow): Promise<void> => {
  await sql`
    INSERT INTO public.practice_rating_events
      (user_id, user_lookup_id, target_language, headword, sense, pool, skill, target_form, rating,
       was_explicit, was_introduction)
    VALUES (${userId}, ${row.id}, 'ru', ${row.headword}, ${row.sense}, 'recognition', 'meaning_recognition', '',
            'good', true, false)
  `
}

const insertKeptCard = async (userId: string, lookupId: string): Promise<string> => {
  const { session } = await StudySessionsRepository().getOrCreateAdhocStudySession({
    userId,
    targetLanguage: 'ru',
    nativeLanguage: 'en',
    cefrLevel: 'B1',
    title: 'merge test',
    trackHash: __generateUniqueId('track'),
    contextBlob: 'ctx',
  })
  const [segment] = (await sql`
    INSERT INTO public.text_segments (text_track_id, index, text)
    VALUES (${session.text_track_id}, ${Math.floor(Math.random() * 1e9)}, 'текст')
    RETURNING id
  `) as [{ id: string }]
  const [card] = (await sql`
    INSERT INTO public.cards (segment_id, study_session_id, surface_form, user_lookup_id, status)
    VALUES (${segment.id}, ${session.id}, 'текст', ${lookupId}, 'kept')
    RETURNING id
  `) as [{ id: string }]
  return card.id
}

describe('findLiveSensesForHeadword', () => {
  test('matches the headword case-insensitively and ignores deleted and sense-less rows', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('Слово')
    const live = await insertLookup({ userId, headword, sense: 'word', createdDaysAgo: 2 })
    const deleted = await insertLookup({ userId, headword, sense: 'term', createdDaysAgo: 1 })
    await sql`UPDATE public.user_lookups SET deleted_at = NOW() WHERE id = ${deleted.id}`
    await insertLookup({ userId, headword, sense: '', createdDaysAgo: 1 })

    const rows = await UserLookupsRepository().findLiveSensesForHeadword({
      userId,
      targetLanguage: 'ru',
      headword: headword.toLowerCase(),
    })

    expect(rows.map((r) => r.id)).toEqual([live.id])
  })
})

describe('mergeUserLookups', () => {
  test('folds the losers into the most-practiced row and deletes them', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('восстание')
    const older = await insertLookup({
      userId,
      headword,
      sense: 'revolt, uprising',
      createdDaysAgo: 10,
      encounterCount: 3,
      translation: null,
    })
    const practiced = await insertLookup({
      userId,
      headword,
      sense: 'uprising, revolt',
      createdDaysAgo: 5,
      encounterCount: 2,
      grammar: { pos: 'noun' },
      translation: 'uprising',
    })
    await sql`UPDATE public.user_lookups SET grammar = ${sql.json({ ipa: 'vəsˈtanʲɪjə' })} WHERE id = ${older.id}`
    const practicedFacet = await insertFacet({ userId, userLookupId: practiced.id, introduced: true, reps: 2 })
    const olderFacet = await insertFacet({ userId, userLookupId: older.id })
    const olderPronunciation = await insertFacet({ userId, userLookupId: older.id, skill: 'pronunciation' })
    await insertRatingEvent(userId, practiced)
    const olderCard = await insertKeptCard(userId, older.id)
    await insertKeptCard(userId, practiced.id)

    const outcome = await mergeUserLookups({ userId, rows: [older, practiced] }, sql)

    expect(outcome).toEqual({ status: 'merged', winnerId: practiced.id })
    const [winner] = (await sql`SELECT * FROM public.user_lookups WHERE id = ${practiced.id}`) as [
      Record<string, unknown>,
    ]
    expect(winner).toMatchObject({
      sense: 'uprising, revolt',
      count: 2,
      encounter_count: 4, // max(3, 2) + one extra row, not the sum
      translation: 'uprising',
      grammar: { pos: 'noun', ipa: 'vəsˈtanʲɪjə' },
    })
    expect((winner.created_at as Date).getTime()).toBeLessThan(Date.now() - 9 * 86_400_000)
    expect(await sql`SELECT id FROM public.user_lookups WHERE id = ${older.id}`).toHaveLength(0)

    const facets = (await sql`
      SELECT id, skill FROM public.study_facets WHERE user_lookup_id = ${practiced.id} ORDER BY skill
    `) as Array<{ id: string; skill: string }>
    // The introduced recognition facet wins the conflict; the loser's
    // non-conflicting pronunciation facet moves over.
    expect(facets.map((f) => f.id).sort()).toEqual([practicedFacet, olderPronunciation].sort())
    expect(await sql`SELECT id FROM public.study_facets WHERE id = ${olderFacet}`).toHaveLength(0)
    const [card] = (await sql`SELECT user_lookup_id FROM public.cards WHERE id = ${olderCard}`) as [
      { user_lookup_id: string },
    ]
    expect(card.user_lookup_id).toBe(practiced.id)
  })

  test('a lookup then a save in the same hour counts once', async () => {
    // Monday's save created A; Tuesday's lookup credited A (2), and the save
    // right after it created B under a new label (1): two episodes, not three.
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('брести')
    const a = await insertLookup({ userId, headword, sense: 'trudge', createdDaysAgo: 2, encounterCount: 2 })
    const b = await insertLookup({ userId, headword, sense: 'walk slowly', createdDaysAgo: 1 })
    await sql`
      UPDATE public.user_lookups
      SET last_demand_at = (SELECT created_at FROM public.user_lookups WHERE id = ${b.id}) - INTERVAL '10 minutes'
      WHERE id = ${a.id}
    `

    const outcome = await mergeUserLookups({ userId, rows: [a, b] }, sql)

    expect(outcome).toEqual({ status: 'merged', winnerId: a.id })
    const [winner] = (await sql`SELECT encounter_count FROM public.user_lookups WHERE id = ${a.id}`) as [
      { encounter_count: number },
    ]
    expect(winner.encounter_count).toBe(2)
  })

  test('keeps the facet with history even when disabled, re-enabled if a duplicate was enabled', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('ветвь')
    const studied = await insertLookup({ userId, headword, sense: 'tree branch', createdDaysAgo: 4 })
    const fresh = await insertLookup({ userId, headword, sense: 'branch (bookish)', createdDaysAgo: 2 })
    const studiedFacet = await insertFacet({ userId, userLookupId: studied.id, introduced: true, reps: 4 })
    await sql`UPDATE public.study_facets SET disabled_at = NOW() WHERE id = ${studiedFacet}`
    await insertFacet({ userId, userLookupId: fresh.id })
    await insertRatingEvent(userId, studied)

    await mergeUserLookups({ userId, rows: [studied, fresh] }, sql)

    const facets = (await sql`
      SELECT id, disabled_at, srs_reps FROM public.study_facets WHERE user_lookup_id = ${studied.id}
    `) as Array<{ id: string; disabled_at: Date | null; srs_reps: number }>
    expect(facets).toEqual([{ id: studiedFacet, disabled_at: null, srs_reps: 4 }])
  })

  test('repoints checkpoint backlog candidates and their evidence', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('шорох')
    const a = await insertLookup({ userId, headword, sense: 'faint rustle', createdDaysAgo: 4 })
    const b = await insertLookup({ userId, headword, sense: 'soft rustle', createdDaysAgo: 2 })
    const { session } = await StudySessionsRepository().getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'checkpoint',
      trackHash: __generateUniqueId('track'),
      contextBlob: 'ctx',
    })
    const [checkpoint] = (await sql`
      INSERT INTO public.study_session_checkpoints
        (user_id, study_session_id, to_segment_index, credited_count, backlog_candidate_ids, backlog_evidence)
      VALUES (${userId}, ${session.id}, 3, 0, ${[a.id, b.id]}::uuid[],
              ${sql.json({ [b.id]: { surface: 'шорох' } })})
      RETURNING id
    `) as [{ id: string }]

    await mergeUserLookups({ userId, rows: [a, b] }, sql)

    const [row] = (await sql`
      SELECT backlog_candidate_ids, backlog_evidence FROM public.study_session_checkpoints WHERE id = ${checkpoint.id}
    `) as [{ backlog_candidate_ids: string[]; backlog_evidence: Record<string, unknown> }]
    expect(row.backlog_candidate_ids).toEqual([a.id])
    expect(row.backlog_evidence).toEqual({ [a.id]: { surface: 'шорох' } })
  })

  test('skips a cluster whose conflicting facets both have practice history', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('пот')
    const a = await insertLookup({ userId, headword, sense: 'sweat', createdDaysAgo: 4 })
    const b = await insertLookup({ userId, headword, sense: 'sweat (noun)', createdDaysAgo: 2 })
    await insertFacet({ userId, userLookupId: a.id, introduced: true })
    await insertFacet({ userId, userLookupId: b.id, introduced: true })
    await insertRatingEvent(userId, a)
    await insertRatingEvent(userId, b)

    expect(await mergeUserLookups({ userId, rows: [a, b] }, sql)).toEqual({
      status: 'skipped',
      reason: 'conflicting practice history',
    })
    expect(await sql`SELECT id FROM public.user_lookups WHERE id IN (${a.id}, ${b.id})`).toHaveLength(2)
  })

  test('skips a cluster edited since planning or owned by someone else', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { id: otherUserId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const headword = __generateUniqueId('лесть')
    const a = await insertLookup({ userId, headword, sense: 'flattery', createdDaysAgo: 4 })
    const b = await insertLookup({ userId, headword, sense: 'insincere praise', createdDaysAgo: 2 })
    await sql`UPDATE public.user_lookups SET sense = 'praise' WHERE id = ${b.id}`

    expect(await mergeUserLookups({ userId, rows: [a, b] }, sql)).toMatchObject({ status: 'skipped' })
    expect(await mergeUserLookups({ userId: otherUserId, rows: [a, { ...b, sense: 'praise' }] }, sql)).toMatchObject({
      status: 'skipped',
    })
    expect(await sql`SELECT id FROM public.user_lookups WHERE id IN (${a.id}, ${b.id})`).toHaveLength(2)
  })
})
