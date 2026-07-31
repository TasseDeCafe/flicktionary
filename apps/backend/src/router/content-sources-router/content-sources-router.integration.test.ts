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
// focused on the per-guest source cap (golden path + 401 + the domain
// failure). Guest tokens require the guest-mode flag on the app under test.
describe('content-sources-router guest source cap', () => {
  const testApp = buildTestApp({ isGuestModeEnabled: true })
  const limit = getConfig().maxSourcesPerGuest

  // TMDB ids land in globally-deduped rows, so every test mints its own.
  const uniqueTmdbId = () => 100_000_000 + Math.floor(Math.random() * 800_000_000)

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

  test('a guest can create sources up to the cap, then gets the typed 403', async () => {
    const { token } = await __getAnonymousSupabaseToken()

    for (let i = 0; i < limit; i++) {
      const response = await createText(token)
      expect(response.status).toBe(201)
    }

    const rejected = await createText(token)
    expect(rejected.status).toBe(403)
    expect(rejected.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)
  })

  test('a regular account is never capped', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

    for (let i = 0; i < limit + 1; i++) {
      const response = await createText(token)
      expect(response.status).toBe(201)
    }
  })

  test('a guest at the cap can still reuse globally-deduped movie and TV sources', async () => {
    const { token: creatorToken } = await __createUserInSupabaseAndGetHisIdAndToken()
    const tmdbId = uniqueTmdbId()
    const tmdbShowId = uniqueTmdbId()
    const existingMovie = await createMovie(creatorToken, tmdbId)
    expect(existingMovie.status).toBe(201)
    const existingEpisode = await createTvEpisode(creatorToken, tmdbShowId)
    expect(existingEpisode.status).toBe(201)

    const { token: guestToken } = await __getAnonymousSupabaseToken()
    for (let i = 0; i < limit; i++) {
      await createText(guestToken)
    }

    // Reuse is not creation: both resolve to the pre-existing rows.
    const reusedMovie = await createMovie(guestToken, tmdbId)
    expect(reusedMovie.status).toBe(201)
    expect(reusedMovie.body.data.id).toBe(existingMovie.body.data.id)
    const reusedEpisode = await createTvEpisode(guestToken, tmdbShowId)
    expect(reusedEpisode.status).toBe(201)
    expect(reusedEpisode.body.data.id).toBe(existingEpisode.body.data.id)

    // A movie/episode new to the catalog would create a row — capped.
    const newMovie = await createMovie(guestToken, uniqueTmdbId())
    expect(newMovie.status).toBe(403)
    expect(newMovie.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)
    const newEpisode = await createTvEpisode(guestToken, uniqueTmdbId())
    expect(newEpisode.status).toBe(403)
    expect(newEpisode.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)
  })

  test('converting the guest lifts the cap immediately', async () => {
    const { id: userId, token } = await __getAnonymousSupabaseToken()

    for (let i = 0; i < limit; i++) {
      await createText(token)
    }
    const rejected = await createText(token)
    expect(rejected.status).toBe(403)

    // Conversion flips auth.users.is_anonymous; the quota reads the live row,
    // so even the still-anonymous JWT is no longer capped.
    await sql`UPDATE auth.users SET is_anonymous = false WHERE id = ${userId}`

    const afterConversion = await createText(token)
    expect(afterConversion.status).toBe(201)
  })
})
