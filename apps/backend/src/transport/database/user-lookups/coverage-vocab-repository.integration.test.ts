import { describe, expect, test } from 'vitest'
import { UserLookupsRepository } from './user-lookups-repository'
import { StudySessionsRepository } from '../study-sessions/study-sessions-repository'
import { StudySessionCheckpointsRepository } from '../study-sessions/study-session-checkpoints-repository'
import { PracticeRatingEventsRepository } from '../practice-rating-events/practice-rating-events-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'

const insertLookup = async (userId: string, targetLanguage: string, headword: string): Promise<string> => {
  const [row] = (await sql`
    INSERT INTO public.user_lookups (user_id, target_language, headword, sense, count)
    VALUES (${userId}, ${targetLanguage}, ${headword}, '', 1)
    RETURNING id
  `) as [{ id: string }]
  return row.id
}

type EventOverrides = {
  rating?: 'again' | 'hard' | 'good' | 'easy'
  skill?: 'meaning_recognition' | 'meaning_production' | 'pronunciation'
  wasExplicit: boolean
  checkpointId?: string | null
}

// The verified-evidence matrix (docs/SRS.md §6c): a lemma verifies only on a
// live good/easy MEANING review that is explicit-or-checkpoint evidence and
// never the assertion lane (was_explicit=TRUE with a checkpoint_id).
describe('listCoverageVocab', () => {
  const insertEvent = async (userId: string, userLookupId: string, overrides: EventOverrides): Promise<string> => {
    return await PracticeRatingEventsRepository().insert({
      userId,
      userLookupId,
      targetLanguage: 'ru',
      pool: 'recognition',
      skill: overrides.skill ?? 'meaning_recognition',
      targetForm: '',
      rating: overrides.rating ?? 'good',
      wasIntroduction: false,
      wasExplicit: overrides.wasExplicit,
      causedParking: false,
      practiceTextId: null,
      studySessionId: null,
      checkpointId: overrides.checkpointId ?? null,
      headword: 'слово',
      sense: '',
      prevSrsState: 'review',
      prevSrsDue: new Date().toISOString(),
      prevSrsStability: 5,
      prevSrsDifficulty: 5,
      prevSrsLastReview: new Date().toISOString(),
      prevSrsReps: 3,
      prevSrsLapses: 0,
      prevSrsLearningSteps: 0,
    })
  }

  const makeCheckpoint = async (userId: string): Promise<string> => {
    const { session } = await StudySessionsRepository().getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'coverage vocab test',
      trackHash: __generateUniqueId('track'),
      contextBlob: 'ctx',
    })
    const checkpoint = await StudySessionCheckpointsRepository().insert({
      userId,
      studySessionId: session.id,
      fromSegmentIndex: null,
      toSegmentIndex: 1,
      creditedCount: 0,
      backlogCandidateIds: [],
      backlogEvidence: {},
    })
    return checkpoint.id
  }

  test('the evidence matrix: what verifies and what never does', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const checkpointId = await makeCheckpoint(userId)

    const explicitGood = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await insertEvent(userId, explicitGood, { wasExplicit: true })

    const checkpointCredit = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await insertEvent(userId, checkpointCredit, { wasExplicit: false, checkpointId })

    // The known-assertion lane: was_explicit=TRUE WITH a checkpoint_id.
    const assertion = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await insertEvent(userId, assertion, { wasExplicit: true, checkpointId })

    const pronunciationOnly = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await insertEvent(userId, pronunciationOnly, { wasExplicit: true, skill: 'pronunciation' })

    // Reading-mode implicit good: neither explicit nor checkpoint evidence.
    const readingImplicit = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await insertEvent(userId, readingImplicit, { wasExplicit: false })

    const againOnly = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await insertEvent(userId, againOnly, { wasExplicit: true, rating: 'again' })

    const reverted = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    const revertedEventId = await insertEvent(userId, reverted, { wasExplicit: true })
    await PracticeRatingEventsRepository().markReverted({ eventId: revertedEventId, userId })

    const neverRated = await insertLookup(userId, 'ru', __generateUniqueId('слово'))

    const rows = await UserLookupsRepository().listCoverageVocab({ userId, targetLanguage: 'ru' })
    const verifiedById = new Map<string, boolean>()
    const idByHeadword = new Map<string, string>()
    for (const [id, headword] of (
      await sql`
      SELECT id, headword FROM public.user_lookups WHERE user_id = ${userId}
    `
    ).map((r) => [r.id as string, r.headword as string] as const)) {
      idByHeadword.set(headword, id)
    }
    for (const row of rows) {
      const id = idByHeadword.get(row.headword)
      if (id) verifiedById.set(id, row.hasVerifiedReview)
    }

    expect(verifiedById.get(explicitGood)).toBe(true)
    expect(verifiedById.get(checkpointCredit)).toBe(true)
    expect(verifiedById.get(assertion)).toBe(false)
    expect(verifiedById.get(pronunciationOnly)).toBe(false)
    expect(verifiedById.get(readingImplicit)).toBe(false)
    expect(verifiedById.get(againOnly)).toBe(false)
    expect(verifiedById.get(reverted)).toBe(false)
    expect(verifiedById.get(neverRated)).toBe(false)
  })

  test('soft-deleted and count=0 lookups are excluded', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const live = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    const deleted = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await sql`UPDATE public.user_lookups SET deleted_at = now() WHERE id = ${deleted}`
    const zeroCount = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await sql`UPDATE public.user_lookups SET count = 0 WHERE id = ${zeroCount}`

    const rows = await UserLookupsRepository().listCoverageVocab({ userId, targetLanguage: 'ru' })
    const ids = new Set(
      (
        await sql`
        SELECT id, headword FROM public.user_lookups WHERE user_id = ${userId}
      `
      )
        .filter((r) => rows.some((row) => row.headword === r.headword))
        .map((r) => r.id as string)
    )
    expect(ids.has(live)).toBe(true)
    expect(ids.has(deleted)).toBe(false)
    expect(ids.has(zeroCount)).toBe(false)
  })
})
