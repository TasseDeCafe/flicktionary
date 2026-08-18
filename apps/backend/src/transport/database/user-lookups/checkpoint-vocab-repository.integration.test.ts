import { describe, expect, test } from 'vitest'
import { UserLookupsRepository } from './user-lookups-repository'
import { StudyFacetsRepository } from '../study-facets/study-facets-repository'
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

describe('checkpoint vocab repository methods', () => {
  test('listCheckpointVocab returns lookups with and without a recognition facet', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const withFacet = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await StudyFacetsRepository().ensureCitationFacet(withFacet)
    const withoutFacet = await insertLookup(userId, 'ru', __generateUniqueId('слово'))

    const rows = await UserLookupsRepository().listCheckpointVocab({ userId, targetLanguage: 'ru' })
    const byId = new Map(rows.map((r) => [r.lookup.id, r]))
    expect(byId.get(withFacet)?.facet).toMatchObject({ srs_state: null, data_status: 'ready' })
    expect(byId.get(withoutFacet)?.facet).toBeNull()
  })

  test('recordContentEncounter bumps content aggregates and last_encountered_at, never encounter_count', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const id = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    await sql`UPDATE public.user_lookups SET last_encountered_at = NOW() - INTERVAL '30 days' WHERE id = ${id}`

    await UserLookupsRepository().recordContentEncounter([id])

    const [row] = (await sql`
      SELECT encounter_count, content_encounter_count, last_content_encounter_at,
        last_encountered_at > NOW() - INTERVAL '1 minute' AS refreshed
      FROM public.user_lookups WHERE id = ${id}
    `) as [
      {
        encounter_count: number
        content_encounter_count: number
        last_content_encounter_at: string
        refreshed: boolean
      },
    ]
    expect(row.encounter_count).toBe(1)
    expect(row.content_encounter_count).toBe(1)
    expect(row.last_content_encounter_at).not.toBeNull()
    expect(row.refreshed).toBe(true)
  })

  test('listLiveEventsForCheckpoint filters by lane (was_explicit) and skips reverted events', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const lookupId = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    const { session } = await StudySessionsRepository().getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'checkpoint events test',
      trackHash: __generateUniqueId('track'),
      contextBlob: 'ctx',
    })
    const checkpoint = await StudySessionCheckpointsRepository().insert({
      userId,
      studySessionId: session.id,
      fromSegmentIndex: null,
      toSegmentIndex: 3,
      creditedCount: 1,
      backlogCandidateIds: [],
      backlogEvidence: {},
    })
    const events = PracticeRatingEventsRepository()
    const baseEvent = {
      userId,
      userLookupId: lookupId,
      targetLanguage: 'ru',
      pool: 'recognition' as const,
      skill: 'meaning_recognition' as const,
      targetForm: '',
      rating: 'good' as const,
      wasIntroduction: false,
      causedParking: false,
      practiceTextId: null,
      studySessionId: session.id,
      checkpointId: checkpoint.id,
      headword: 'слово',
      sense: '',
      prevSrsState: 'review' as const,
      prevSrsDue: new Date().toISOString(),
      prevSrsStability: 5,
      prevSrsDifficulty: 5,
      prevSrsLastReview: new Date().toISOString(),
      prevSrsReps: 3,
      prevSrsLapses: 0,
      prevSrsLearningSteps: 0,
    }
    const implicitId = await events.insert({ ...baseEvent, wasExplicit: false })
    const explicitId = await events.insert({ ...baseEvent, wasExplicit: true })
    const revertedId = await events.insert({ ...baseEvent, wasExplicit: false })
    await events.markReverted({ eventId: revertedId, userId })

    const implicitLane = await events.listLiveEventsForCheckpoint({
      checkpointId: checkpoint.id,
      userId,
      wasExplicit: false,
    })
    expect(implicitLane.map((e) => e.id)).toEqual([implicitId])
    const explicitLane = await events.listLiveEventsForCheckpoint({
      checkpointId: checkpoint.id,
      userId,
      wasExplicit: true,
    })
    expect(explicitLane.map((e) => e.id)).toEqual([explicitId])
  })
})
