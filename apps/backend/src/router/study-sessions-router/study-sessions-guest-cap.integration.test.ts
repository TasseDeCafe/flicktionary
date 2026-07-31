import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import {
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { getConfig } from '../../config/environment-config'
import { sql } from '../../transport/database/postgres-client'

// The guest library cap at the session-attach step: globally-deduped movie/TV
// sources created by OTHER users consume a guest's library slot when a session
// is attached (the row-creation gates never fire for them). This is the
// "guest adds 6 Breaking Bad episodes" hole.
describe('study-sessions-router guest library cap', () => {
  const testApp = buildTestApp({ isGuestModeEnabled: true })
  const limit = getConfig().maxSourcesPerGuest

  const insertForeignSourceWithTrack = async (creatorId: string) => {
    const sourceRows = (await sql`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('tv', ${__generateUniqueId('guest-cap-episode')}, 'de', '{}'::jsonb, ${creatorId})
      RETURNING id
    `) as { id: string }[]
    const sourceId = sourceRows[0]!.id
    const trackRows = (await sql`
      INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
      VALUES (${sourceId}, 'paste', 'de', NULL, ${__generateUniqueId('guest-cap-track')})
      RETURNING id
    `) as { id: string }[]
    return { sourceId, trackId: trackRows[0]!.id }
  }

  const createSession = (token: string, sourceId: string, trackId: string) =>
    request(testApp).post('/api/v1/study-sessions').set(buildAuthorizationHeaders(token)).send({
      contentSourceId: sourceId,
      textTrackId: trackId,
      nativeLanguage: 'en',
      targetLanguage: 'de',
      cefrLevel: 'B1',
    })

  test('a guest can attach sessions to existing sources up to the cap; deleting one frees the slot', async () => {
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { token: guestToken } = await __getAnonymousSupabaseToken()

    const episodes: { sourceId: string; trackId: string }[] = []
    for (let i = 0; i < limit + 1; i++) {
      episodes.push(await insertForeignSourceWithTrack(creatorId))
    }

    let lastSessionId = ''
    for (let i = 0; i < limit; i++) {
      const response = await createSession(guestToken, episodes[i]!.sourceId, episodes[i]!.trackId)
      expect(response.status).toBe(201)
      lastSessionId = response.body.data.id
    }

    const rejected = await createSession(guestToken, episodes[limit]!.sourceId, episodes[limit]!.trackId)
    expect(rejected.status).toBe(403)
    expect(rejected.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)

    // Re-attaching a source already in the library resolves to the existing
    // session instead of consuming a slot.
    const reattached = await createSession(guestToken, episodes[limit - 1]!.sourceId, episodes[limit - 1]!.trackId)
    expect(reattached.status).toBe(201)
    expect(reattached.body.alreadyExisted).toBe(true)

    // Deleting a session frees the slot for a different source.
    const removed = await request(testApp)
      .delete(`/api/v1/study-sessions/${lastSessionId}`)
      .set(buildAuthorizationHeaders(guestToken))
    expect(removed.status).toBe(200)

    const afterDelete = await createSession(guestToken, episodes[limit]!.sourceId, episodes[limit]!.trackId)
    expect(afterDelete.status).toBe(201)
  })

  test('concurrent attaches cannot race past the cap', async () => {
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { token: guestToken } = await __getAnonymousSupabaseToken()

    const episodes: { sourceId: string; trackId: string }[] = []
    for (let i = 0; i < limit + 3; i++) {
      episodes.push(await insertForeignSourceWithTrack(creatorId))
    }

    // The quota takes a per-user advisory lock inside the insert transaction,
    // so a parallel burst admits exactly `limit` sessions — without it, every
    // request could read a below-cap count and slip through.
    const responses = await Promise.all(
      episodes.map((episode) => createSession(guestToken, episode.sourceId, episode.trackId))
    )
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b)
    expect(statuses).toEqual([...Array(limit).fill(201), ...Array(3).fill(403)])
  })

  test('a regular account attaches without limit', async () => {
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

    for (let i = 0; i < limit + 1; i++) {
      const episode = await insertForeignSourceWithTrack(creatorId)
      const response = await createSession(token, episode.sourceId, episode.trackId)
      expect(response.status).toBe(201)
    }
  })
})
