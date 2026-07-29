import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildTestApp,
} from '../../test/test-utils'
import { UpstreamRateLimitError } from '../../transport/third-party/upstream-rate-limit-error'

const srtContent = `1
00:00:01,000 --> 00:00:02,000
Hallo Welt

2
00:00:03,000 --> 00:00:04,000
Wie geht's?
`

// The shared test DB never resets, so every test seeds its own content source
// with a unique tmdbId (createFromTmdb reuses rows by tmdbId globally).
const uniqueTmdbId = () => Math.floor(Math.random() * 1_000_000_000) + 1_000_000

const createContentSource = async (testApp: ReturnType<typeof buildTestApp>, token: string): Promise<string> => {
  const response = await request(testApp)
    .post('/api/v1/content-sources/tmdb')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      tmdbId: uniqueTmdbId(),
      title: 'Test Movie',
      originalTitle: 'Test Movie',
      year: 2020,
      posterUrl: null,
      language: 'de',
    })
  expect(response.status).toBe(201)
  return response.body.data.id as string
}

// Drives the oRPC contract over real HTTP through buildApp, with the
// quota-counted OpenSubtitles download scripted via
// AppDependencies.openSubtitlesDownloadSrt. Golden path (+ the pre-download
// dedupe, which is the reason the seam exists), one auth failure, and the
// quota-exceeded domain failure; exhaustive scenarios stay in the unit tests.
describe('text-tracks-router', () => {
  test('returns 401 when unauthenticated', async () => {
    const testApp = buildTestApp()

    const response = await request(testApp)
      .post('/api/v1/text-tracks/opensubtitles/import')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ contentSourceId: '00000000-0000-0000-0000-000000000001', fileId: 1, language: 'de' })

    expect(response.status).toBe(401)
  })

  test('golden path: imports a subtitle, then a repeat import reuses the track without a second download', async () => {
    const downloadSrt = vi.fn().mockResolvedValue(srtContent)
    const testApp = buildTestApp({ openSubtitlesDownloadSrt: downloadSrt })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    const contentSourceId = await createContentSource(testApp, token)
    const fileId = uniqueTmdbId()

    const first = await request(testApp)
      .post('/api/v1/text-tracks/opensubtitles/import')
      .set({ Authorization: `Bearer ${token}` })
      .send({ contentSourceId, fileId, language: 'de' })

    expect(first.status).toBe(201)
    expect(first.body.data.segmentCount).toBe(2)
    expect(first.body.data.track).toMatchObject({
      contentSourceId,
      source: 'opensubtitles',
      language: 'de',
      externalId: String(fileId),
    })
    expect(downloadSrt).toHaveBeenCalledTimes(1)

    const second = await request(testApp)
      .post('/api/v1/text-tracks/opensubtitles/import')
      .set({ Authorization: `Bearer ${token}` })
      .send({ contentSourceId, fileId, language: 'de' })

    expect(second.status).toBe(201)
    expect(second.body.data.track.id).toBe(first.body.data.track.id)
    expect(second.body.data.segmentCount).toBe(2)
    // The dedupe must fire BEFORE the download — this is what protects the
    // shared OpenSubtitles daily quota from repeat imports of popular titles.
    expect(downloadSrt).toHaveBeenCalledTimes(1)
  })

  test('answers 429 with UPSTREAM_QUOTA_EXCEEDED when the OpenSubtitles daily quota is spent', async () => {
    const downloadSrt = vi
      .fn()
      .mockRejectedValue(
        new UpstreamRateLimitError(
          'opensubtitles',
          'quota_exceeded',
          'OpenSubtitles daily download quota exceeded (406)'
        )
      )
    const testApp = buildTestApp({ openSubtitlesDownloadSrt: downloadSrt })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    const contentSourceId = await createContentSource(testApp, token)

    const response = await request(testApp)
      .post('/api/v1/text-tracks/opensubtitles/import')
      .set({ Authorization: `Bearer ${token}` })
      .send({ contentSourceId, fileId: uniqueTmdbId(), language: 'de' })

    expect(response.status).toBe(429)
    expect(response.body.data.errors[0]).toMatchObject({ code: 'UPSTREAM_QUOTA_EXCEEDED' })
  })
})
