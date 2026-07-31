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

// Drives the source-creating procedures over real HTTP through buildApp,
// focused on the per-guest library cap (golden path + 401 + the domain
// failure). Guest tokens require the guest-mode flag on the app under test.
describe('content-sources-router guest source cap', () => {
  const testApp = buildTestApp({ isGuestModeEnabled: true })
  const limit = getConfig().maxSourcesPerGuest

  // TMDB ids land in globally-deduped rows, so every test mints its own.
  const uniqueTmdbId = () => 100_000_000 + Math.floor(Math.random() * 800_000_000)

  // The library counts sources with a LIVE session — fill it with fixture
  // sources owned by `creatorId`, attached to the guest via sessions.
  const fillLibrary = async (userId: string, creatorId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const sourceRows = (await sql`
        INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
        VALUES ('movie', ${__generateUniqueId('guest-cap-lib')}, 'de', '{}'::jsonb, ${creatorId})
        RETURNING id
      `) as { id: string }[]
      const trackRows = (await sql`
        INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
        VALUES (${sourceRows[0]!.id}, 'paste', 'de', NULL, ${__generateUniqueId('guest-cap-track')})
        RETURNING id
      `) as { id: string }[]
      await sql`
        INSERT INTO public.study_sessions (
          user_id, content_source_id, text_track_id, native_language, target_language, cefr_level
        )
        VALUES (${userId}, ${sourceRows[0]!.id}, ${trackRows[0]!.id}, 'en', 'de', 'B1')
      `
    }
  }

  const createText = (token: string) =>
    request(testApp)
      .post('/api/v1/content-sources/text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: __generateUniqueId('guest-cap-text'), language: 'de' })

  const createMovie = (token: string, tmdbId: number) =>
    request(testApp).post('/api/v1/content-sources/tmdb').set(buildAuthorizationHeaders(token)).send({
      tmdbId,
      title: 'Some movie',
      originalTitle: 'Some movie',
      year: 2020,
      posterUrl: null,
      language: 'de',
    })

  const createTvEpisode = (token: string, tmdbShowId: number) =>
    request(testApp).post('/api/v1/content-sources/tmdb/tv').set(buildAuthorizationHeaders(token)).send({
      tmdbShowId,
      showTitle: 'Some show',
      originalTitle: 'Some show',
      seasonNumber: 1,
      episodeNumber: 1,
      episodeTitle: 'Pilot',
      year: 2020,
      posterUrl: null,
      language: 'de',
    })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/content-sources/text')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ title: 'Nope', language: 'de' })

    expect(response.status).toBe(401)
  })

  test('a guest with a full library gets the typed 403 on every creating procedure', async () => {
    const { id: guestId, token } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await fillLibrary(guestId, creatorId, limit)

    const rejectedText = await createText(token)
    expect(rejectedText.status).toBe(403)
    expect(rejectedText.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)

    const rejectedMovie = await createMovie(token, uniqueTmdbId())
    expect(rejectedMovie.status).toBe(403)
    expect(rejectedMovie.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)

    const rejectedEpisode = await createTvEpisode(token, uniqueTmdbId())
    expect(rejectedEpisode.status).toBe(403)
    expect(rejectedEpisode.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)
  })

  test('sessionless creations below the cap never consume library slots', async () => {
    const { token } = await __getAnonymousSupabaseToken()

    // Abandoned-wizard shape: source rows without sessions. The library stays
    // empty, so creation keeps working well past the numeric cap.
    for (let i = 0; i < limit + 2; i++) {
      const response = await createText(token)
      expect(response.status).toBe(201)
    }
  })

  test('a guest at the cap can still reuse globally-deduped movie and TV sources', async () => {
    const { token: creatorToken, id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const tmdbId = uniqueTmdbId()
    const tmdbShowId = uniqueTmdbId()
    const existingMovie = await createMovie(creatorToken, tmdbId)
    expect(existingMovie.status).toBe(201)
    const existingEpisode = await createTvEpisode(creatorToken, tmdbShowId)
    expect(existingEpisode.status).toBe(201)

    const { id: guestId, token: guestToken } = await __getAnonymousSupabaseToken()
    await fillLibrary(guestId, creatorId, limit)

    // Reuse is not creation: both resolve to the pre-existing rows (attaching
    // a session to them is where the cap bites — see the study-sessions test).
    const reusedMovie = await createMovie(guestToken, tmdbId)
    expect(reusedMovie.status).toBe(201)
    expect(reusedMovie.body.data.id).toBe(existingMovie.body.data.id)
    const reusedEpisode = await createTvEpisode(guestToken, tmdbShowId)
    expect(reusedEpisode.status).toBe(201)
    expect(reusedEpisode.body.data.id).toBe(existingEpisode.body.data.id)
  })

  test('a regular account is never capped', async () => {
    const { id: userId, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await fillLibrary(userId, userId, limit + 1)

    const response = await createText(token)
    expect(response.status).toBe(201)
  })

  test('converting the guest lifts the cap immediately', async () => {
    const { id: guestId, token } = await __getAnonymousSupabaseToken()
    const { id: creatorId } = await __createUserInSupabaseAndGetHisIdAndToken()
    await fillLibrary(guestId, creatorId, limit)

    const rejected = await createText(token)
    expect(rejected.status).toBe(403)

    // Conversion flips auth.users.is_anonymous; the quota reads the live row,
    // so even the still-anonymous JWT is no longer capped.
    await sql`UPDATE auth.users SET is_anonymous = false WHERE id = ${guestId}`

    const afterConversion = await createText(token)
    expect(afterConversion.status).toBe(201)
  })
})
