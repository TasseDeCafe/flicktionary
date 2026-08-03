import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
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
      backdropUrl: null,
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
    // OpenSubtitles is a third-party catalog and is deliberately NOT
    // moderated — the un-scripted vi.fn() below proves no moderation call
    // happens on this path (fail-open would otherwise mask a regression).
    const moderationPass = vi.fn()
    const testApp = buildTestApp({
      openSubtitlesDownloadSrt: downloadSrt,
      anthropicPasses: MockAnthropicPasses({ moderationPass: moderationPass as never }),
    })
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
    expect(moderationPass).not.toHaveBeenCalled()
  })

  test('uploadSrt imports a benign file and rejects a hard-blocked one with CONTENT_BLOCKED', async () => {
    const moderationPass = vi
      .fn()
      .mockResolvedValueOnce({ verdict: 'allow' })
      .mockResolvedValueOnce({ verdict: 'block', category: 'sexual-explicit' })
    const testApp = buildTestApp({
      anthropicPasses: MockAnthropicPasses({ moderationPass: moderationPass as never }),
    })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    const contentSourceId = await createContentSource(testApp, token)

    const allowed = await request(testApp)
      .post('/api/v1/text-tracks/upload')
      .set({ Authorization: `Bearer ${token}` })
      .send({ contentSourceId, language: 'de', srtContent })
    expect(allowed.status).toBe(201)
    expect(allowed.body.data.segmentCount).toBe(2)

    // Different cue text → different hash, so this import is NOT deduped and
    // hits the second scripted verdict.
    const blocked = await request(testApp)
      .post('/api/v1/text-tracks/upload')
      .set({ Authorization: `Bearer ${token}` })
      .send({ contentSourceId, language: 'de', srtContent: srtContent.replace('Hallo Welt', 'Anderer Text') })
    expect(blocked.status).toBe(422)
    expect(blocked.body.data.errors[0]).toMatchObject({ code: 'CONTENT_BLOCKED' })
  })

  test('importFromPaste rejects hard-blocked text with CONTENT_BLOCKED and creates nothing', async () => {
    const moderationPass = vi.fn().mockResolvedValue({ verdict: 'block', category: 'sexual-explicit' })
    const testApp = buildTestApp({
      anthropicPasses: MockAnthropicPasses({ moderationPass: moderationPass as never }),
    })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    const contentSourceId = await createContentSource(testApp, token)

    const response = await request(testApp)
      .post('/api/v1/text-tracks/paste')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        contentSourceId,
        language: 'de',
        text: 'Dieser Text ist lang genug für die Mindestlänge des Einfüge-Imports.',
      })
    expect(response.status).toBe(422)
    expect(response.body.data.errors[0]).toMatchObject({ code: 'CONTENT_BLOCKED' })
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
    const testApp = buildTestApp({
      openSubtitlesDownloadSrt: downloadSrt,
      anthropicPasses: MockAnthropicPasses(),
    })
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
