import { describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { sql } from '../../transport/database/postgres-client'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'

// The YouTube ingest path is the one shareable surface without an ingest
// moderation gate — auto-share moderates at publish time and persists the
// verdict on the track (including the share-only 'blocked' status).
describe('study-sessions youtube auto-share', () => {
  const testApp = buildTestApp({
    isGuestModeEnabled: true,
    anthropicPasses: MockAnthropicPasses({
      languageDetectionPass: async () => 'de',
      moderationPass: async (chunk: string) => {
        if (chunk.includes('blockme')) return { verdict: 'block' as const, category: 'sexual-explicit' as const }
        if (chunk.includes('flagme')) return { verdict: 'flag' as const, category: 'violence' as const }
        return { verdict: 'allow' as const }
      },
    }),
  })

  // Ingest prefs need a native language (users row) and a CEFR pref for the
  // detected language — prefs-style setup, done directly.
  const seedIngestPrefs = async (token: string, userId: string) => {
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await sql`UPDATE public.users SET native_language = 'en' WHERE id = ${userId}`
    const response = await request(testApp)
      .put('/api/v1/user-prefs/cefr-for-language')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'de', cefrLevel: 'B1' })
    expect(response.status).toBe(200)
  }

  const ingestVideo = (token: string, videoId: string, videoTitle: string, text: string) =>
    request(testApp)
      .post('/api/v1/study-sessions/find-or-create-for-youtube-video')
      .set(buildAuthorizationHeaders(token))
      .send({
        youtubeVideoId: videoId,
        videoTitle,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        subtitles: {
          contentHash: __generateUniqueId('yt-hash'),
          segments: [
            { index: 0, text, startMs: 0, endMs: 2000 },
            {
              index: 1,
              text: 'Und hier ist noch ein zweiter Untertitel für die Erkennung.',
              startMs: 2000,
              endMs: 4000,
            },
          ],
        },
      })

  const entriesForVideo = async (videoId: string) =>
    (await sql`
      SELECT e.*, t.moderation_status
      FROM public.shared_content_entries e
      JOIN public.text_tracks t ON t.id = e.text_track_id
      WHERE e.canonical_key = ${`youtube:${videoId}`}
    `) as { unshared_at: string | null; moderation_status: string | null }[]

  test('a regular account auto-publishes a clean video; the verdict is backfilled on the track', async () => {
    const user = await __createUserInSupabaseAndGetHisIdAndToken()
    await seedIngestPrefs(user.token, user.id)
    const videoId = __generateUniqueId('vid')

    const response = await ingestVideo(user.token, videoId, 'Ein schönes Video', 'Guten Morgen liebe Zuschauer.')
    expect(response.status).toBe(200)

    await expect.poll(async () => (await entriesForVideo(videoId)).length, { timeout: 5000 }).toBe(1)
    const [entry] = await entriesForVideo(videoId)
    expect(entry!.unshared_at).toBeNull()
    expect(entry!.moderation_status).toBe('clean')
  })

  test('guest ingests never publish', async () => {
    const guest = await __getAnonymousSupabaseToken()
    await seedIngestPrefs(guest.token, guest.id)
    const videoId = __generateUniqueId('vid')

    const response = await ingestVideo(guest.token, videoId, 'Gastvideo', 'Hallo aus dem Gastmodus heute.')
    expect(response.status).toBe(200)

    // The publish is async — settle, then assert nothing appeared.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(await entriesForVideo(videoId)).toEqual([])
  })

  test('hard-blocked transcripts persist the blocked verdict and never publish', async () => {
    const user = await __createUserInSupabaseAndGetHisIdAndToken()
    await seedIngestPrefs(user.token, user.id)
    const videoId = __generateUniqueId('vid')

    const response = await ingestVideo(user.token, videoId, 'Harmloser Titel', 'blockme dieser Inhalt ist schlimm.')
    expect(response.status).toBe(200)
    const textTrackId = response.body.data.textTrackId as string

    await expect
      .poll(
        async () =>
          (
            (await sql`
              SELECT moderation_status FROM public.text_tracks WHERE id = ${textTrackId}
            `) as { moderation_status: string | null }[]
          )[0]?.moderation_status,
        { timeout: 5000 }
      )
      .toBe('blocked')
    expect(await entriesForVideo(videoId)).toEqual([])
  })

  test('a title rewrite that fails moderation takes the live entry down', async () => {
    const user = await __createUserInSupabaseAndGetHisIdAndToken()
    await seedIngestPrefs(user.token, user.id)
    const videoId = __generateUniqueId('vid')

    const first = await ingestVideo(user.token, videoId, 'Ein schönes Video', 'Willkommen zurück zum Kanal.')
    expect(first.status).toBe(200)
    await expect.poll(async () => (await entriesForVideo(videoId)).length, { timeout: 5000 }).toBe(1)

    // Re-ingest (same video, same owner) with a dirty title — the fence
    // re-moderates the always-overwritten source title and unshares.
    const second = await ingestVideo(user.token, videoId, 'blockme Titel', 'Willkommen zurück zum Kanal.')
    expect(second.status).toBe(200)
    await expect
      .poll(async () => (await entriesForVideo(videoId))[0]?.unshared_at !== null, { timeout: 5000 })
      .toBe(true)
  })
})
