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

    const rows = await UserLookupsRepository().listCheckpointVocab({
      userId,
      targetLanguage: 'ru',
      contentSourceId: null,
    })
    const byId = new Map(rows.map((r) => [r.lookup.id, r]))
    expect(byId.get(withFacet)?.facet).toMatchObject({ srs_state: null, data_status: 'ready' })
    expect(byId.get(withoutFacet)?.facet).toBeNull()
  })

  test('listCheckpointVocab flags terms with a card in any session of the given content source', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const savedHere = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    const savedElsewhere = await insertLookup(userId, 'ru', __generateUniqueId('слово'))
    // Adhoc sources are one per (user, language), so two languages give two
    // distinct content sources.
    const createSession = async (
      targetLanguage: string
    ): Promise<{ id: string; content_source_id: string; text_track_id: string }> => {
      const { session } = await StudySessionsRepository().getOrCreateAdhocStudySession({
        userId,
        targetLanguage,
        nativeLanguage: 'en',
        cefrLevel: 'B1',
        title: 'saved-in-source test',
        trackHash: __generateUniqueId('track'),
        contextBlob: 'ctx',
      })
      return session
    }
    const reading = await createSession('ru')
    const insertCard = async (lookupId: string, session: { id: string; text_track_id: string }): Promise<void> => {
      const [segment] = (await sql`
        INSERT INTO public.text_segments (text_track_id, index, text)
        VALUES (${session.text_track_id}, 0, 'текст')
        ON CONFLICT DO NOTHING
        RETURNING id
      `) as Array<{ id: string }>
      const segmentId =
        segment?.id ??
        (
          (await sql`
          SELECT id FROM public.text_segments WHERE text_track_id = ${session.text_track_id} AND index = 0
        `) as [{ id: string }]
        )[0].id
      await sql`
        INSERT INTO public.cards (segment_id, study_session_id, surface_form, user_lookup_id)
        VALUES (${segmentId}, ${session.id}, 'текст', ${lookupId})
      `
    }
    await insertCard(savedHere, reading)
    await insertCard(savedElsewhere, await createSession('de'))

    const repository = UserLookupsRepository()
    const flags = async (contentSourceId: string | null): Promise<Map<string, boolean>> => {
      const rows = await repository.listCheckpointVocab({ userId, targetLanguage: 'ru', contentSourceId })
      return new Map(rows.map((r) => [r.lookup.id, r.savedInSource]))
    }
    const scoped = await flags(reading.content_source_id)
    expect(scoped.get(savedHere)).toBe(true)
    expect(scoped.get(savedElsewhere)).toBe(false)
    const unscoped = await flags(null)
    expect(unscoped.get(savedHere)).toBe(false)
    expect(unscoped.get(savedElsewhere)).toBe(false)
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
