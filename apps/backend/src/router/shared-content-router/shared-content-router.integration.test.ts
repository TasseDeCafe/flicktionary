import { describe, expect, test } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import {
  ERROR_CODE_FOR_CEFR_REQUIRED,
  ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED,
} from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { getConfig } from '../../config/environment-config'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'

// Content-scripted moderation: verdicts follow the text, so one app instance
// serves every scenario (including the fire-and-forget publish calls that may
// straggle past a test's own assertions).
const scriptedModerationPass = async (chunk: string) => {
  if (chunk.includes('blockme')) return { verdict: 'block' as const, category: 'sexual-explicit' as const }
  if (chunk.includes('flagme')) return { verdict: 'flag' as const, category: 'violence' as const }
  return { verdict: 'allow' as const }
}

// Unique per call: the canonical key is the content hash, and the shared test
// DB never resets — a fixed body would let the FIRST-ever run publish and
// leave its live entry blocking every later run's publish as a duplicate.
const uniquePasteText = () =>
  `Der kleine Prinz kam auf einen neuen Planeten und begrüßte die Bewohner sehr freundlich ${__generateUniqueId('satz')}.`

// createText caps language at 10 chars — a compact unique code keeps list
// assertions isolated on the shared never-reset DB.
const uniqueLanguage = () => `l${Math.random().toString(36).slice(2, 10)}`

describe('shared-content-router', () => {
  const testApp: Express = buildTestApp({
    isGuestModeEnabled: true,
    anthropicPasses: MockAnthropicPasses({ moderationPass: scriptedModerationPass }),
  })

  // Web-paste flow seeded through the API: source row, track (moderated
  // inline), session with the opt-in share flag.
  const createSharedPasteSession = async (token: string, language: string, shareToExplore: boolean) => {
    const sourceResponse = await request(testApp)
      .post('/api/v1/content-sources/text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: __generateUniqueId('shared-title'), language })
    expect(sourceResponse.status).toBe(201)
    const contentSourceId = sourceResponse.body.data.id as string

    const pasteText = uniquePasteText()
    const trackResponse = await request(testApp)
      .post('/api/v1/text-tracks/paste')
      .set(buildAuthorizationHeaders(token))
      .send({ contentSourceId, language, text: pasteText })
    expect(trackResponse.status).toBe(201)
    const textTrackId = trackResponse.body.data.track.id as string

    const sessionResponse = await request(testApp)
      .post('/api/v1/study-sessions')
      .set(buildAuthorizationHeaders(token))
      .send({
        contentSourceId,
        textTrackId,
        nativeLanguage: 'en',
        targetLanguage: language,
        cefrLevel: 'B1',
        shareToExplore,
      })
    expect(sessionResponse.status).toBe(201)
    return { contentSourceId, textTrackId, sessionId: sessionResponse.body.data.id as string, pasteText }
  }

  const listEntries = async (token: string, language: string) => {
    const response = await request(testApp)
      .get(`/api/v1/shared-content?language=${language}`)
      .set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
    return response.body.data as { id: string; title: string; language: string }[]
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp).get('/api/v1/shared-content').set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
  })

  test('opt-in paste share publishes after session creation, toggle round-trips, feed follows', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const language = uniqueLanguage()

    const { textTrackId } = await createSharedPasteSession(owner.token, language, true)

    // The opt-in publish is fire-and-forget behind session creation.
    await expect.poll(async () => (await listEntries(owner.token, language)).length, { timeout: 5000 }).toBe(1)

    const state = await request(testApp)
      .get(`/api/v1/shared-content/share-state?textTrackId=${textTrackId}`)
      .set(buildAuthorizationHeaders(owner.token))
    expect(state.body.data.state).toBe('shared')

    // A stranger sees no owner toggle on the same track.
    const stranger = await __createUserInSupabaseAndGetHisIdAndToken()
    const strangerState = await request(testApp)
      .get(`/api/v1/shared-content/share-state?textTrackId=${textTrackId}`)
      .set(buildAuthorizationHeaders(stranger.token))
    expect(strangerState.body.data.state).toBe('not-shareable')

    const toggleOff = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: false })
    expect(toggleOff.status).toBe(200)
    expect(toggleOff.body.data.state).toBe('not-shared')
    expect(await listEntries(owner.token, language)).toEqual([])

    const toggleOn = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: true })
    expect(toggleOn.status).toBe(200)
    expect(toggleOn.body.data.state).toBe('shared')
    expect((await listEntries(owner.token, language)).length).toBe(1)
  })

  test('detail: full text for any authenticated user while live, 404 once unshared', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const language = uniqueLanguage()
    const { textTrackId, pasteText } = await createSharedPasteSession(owner.token, language, true)
    await expect.poll(async () => (await listEntries(owner.token, language)).length, { timeout: 5000 }).toBe(1)
    const [entry] = await listEntries(owner.token, language)

    const unauthenticated = await request(testApp)
      .get(`/api/v1/shared-content/${entry!.id}/detail`)
      .set({ Authorization: 'Bearer wrong-token' })
    expect(unauthenticated.status).toBe(401)

    // A stranger — no session on the track — reads the full text pre-add.
    const reader = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: reader.token, referral: null })
    const detail = await request(testApp)
      .get(`/api/v1/shared-content/${entry!.id}/detail`)
      .set(buildAuthorizationHeaders(reader.token))
    expect(detail.status).toBe(200)
    expect(detail.body.data.id).toBe(entry!.id)
    expect(detail.body.data.language).toBe(language)
    expect(detail.body.data.segmentCount).toBeGreaterThanOrEqual(1)
    expect(detail.body.data.text).toContain(pasteText)

    // Owner unshares → the retained entry id stops resolving.
    const toggleOff = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: false })
    expect(toggleOff.status).toBe(200)
    const dead = await request(testApp)
      .get(`/api/v1/shared-content/${entry!.id}/detail`)
      .set(buildAuthorizationHeaders(reader.token))
    expect(dead.status).toBe(404)
  })

  test('addToLibrary: golden path, idempotence, missing CEFR, dead entry, guest cap', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const language = uniqueLanguage()
    const { textTrackId } = await createSharedPasteSession(owner.token, language, true)
    await expect.poll(async () => (await listEntries(owner.token, language)).length, { timeout: 5000 }).toBe(1)
    const [entry] = await listEntries(owner.token, language)

    const reader = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: reader.token, referral: null })

    // No CEFR pref for the entry's language yet → typed 422.
    const withoutCefr = await request(testApp)
      .post(`/api/v1/shared-content/${entry!.id}/add`)
      .set(buildAuthorizationHeaders(reader.token))
      .send({ nativeLanguage: 'en' })
    expect(withoutCefr.status).toBe(422)
    expect(withoutCefr.body.data.errors[0].code).toBe(ERROR_CODE_FOR_CEFR_REQUIRED)

    const setCefr = await request(testApp)
      .put('/api/v1/user-prefs/cefr-for-language')
      .set(buildAuthorizationHeaders(reader.token))
      .send({ targetLanguage: language, cefrLevel: 'B1' })
    expect(setCefr.status).toBe(200)

    const added = await request(testApp)
      .post(`/api/v1/shared-content/${entry!.id}/add`)
      .set(buildAuthorizationHeaders(reader.token))
      .send({ nativeLanguage: 'en' })
    expect(added.status).toBe(201)
    expect(added.body.alreadyExisted).toBe(false)
    expect(added.body.data.targetLanguage).toBe(language)

    const again = await request(testApp)
      .post(`/api/v1/shared-content/${entry!.id}/add`)
      .set(buildAuthorizationHeaders(reader.token))
      .send({ nativeLanguage: 'en' })
    expect(again.status).toBe(201)
    expect(again.body.alreadyExisted).toBe(true)

    // Owner unshares → the retained entry id stops working.
    await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: false })
    const other = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: other.token, referral: null })
    await request(testApp)
      .put('/api/v1/user-prefs/cefr-for-language')
      .set(buildAuthorizationHeaders(other.token))
      .send({ targetLanguage: language, cefrLevel: 'B1' })
    const deadAdd = await request(testApp)
      .post(`/api/v1/shared-content/${entry!.id}/add`)
      .set(buildAuthorizationHeaders(other.token))
      .send({ nativeLanguage: 'en' })
    expect(deadAdd.status).toBe(404)

    // The reader's session survives the unshare.
    const readerSessions = await request(testApp)
      .get('/api/v1/study-sessions')
      .set(buildAuthorizationHeaders(reader.token))
    expect(readerSessions.body.data.some((s: { id: string }) => s.id === added.body.data.id)).toBe(true)
  })

  test('addToLibrary counts against the guest library cap', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const limit = getConfig().maxSourcesPerGuest

    const entryIds: string[] = []
    for (let i = 0; i < limit + 1; i++) {
      const language = uniqueLanguage()
      await createSharedPasteSession(owner.token, language, true)
      await expect.poll(async () => (await listEntries(owner.token, language)).length, { timeout: 5000 }).toBe(1)
      entryIds.push((await listEntries(owner.token, language))[0]!.id)
    }

    const { token: guestToken } = await __getAnonymousSupabaseToken()
    for (const [index, entryId] of entryIds.entries()) {
      // Guests skip the CEFR dialog seeding — set the pref directly via API.
      const entryLanguageResponse = await request(testApp)
        .get('/api/v1/shared-content')
        .set(buildAuthorizationHeaders(guestToken))
      expect(entryLanguageResponse.status).toBe(200)
      const entryRow = (entryLanguageResponse.body.data as { id: string; language: string }[]).find(
        (row) => row.id === entryId
      )
      await request(testApp)
        .put('/api/v1/user-prefs/cefr-for-language')
        .set(buildAuthorizationHeaders(guestToken))
        .send({ targetLanguage: entryRow!.language, cefrLevel: 'B1' })

      const response = await request(testApp)
        .post(`/api/v1/shared-content/${entryId}/add`)
        .set(buildAuthorizationHeaders(guestToken))
        .send({ nativeLanguage: 'en' })
      if (index < limit) {
        expect(response.status).toBe(201)
      } else {
        expect(response.status).toBe(403)
        expect(response.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED)
      }
    }
  })

  test('admin endpoints gate on test users; a tombstone blocks re-sharing', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const language = uniqueLanguage()
    const { textTrackId } = await createSharedPasteSession(owner.token, language, true)
    await expect.poll(async () => (await listEntries(owner.token, language)).length, { timeout: 5000 }).toBe(1)
    const [entry] = await listEntries(owner.token, language)

    const outsider = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: outsider.token, referral: null })
    const forbidden = await request(testApp)
      .get('/api/v1/shared-content/admin/entries')
      .set(buildAuthorizationHeaders(outsider.token))
    expect(forbidden.status).toBe(403)

    const admin = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: admin.token, referral: null })
    // The config singleton is per-worker, so this mutation cannot leak into
    // other test files running in parallel.
    getConfig().emailsOfTestUsers.push(admin.email)

    const featured = await request(testApp)
      .put(`/api/v1/shared-content/admin/entries/${entry!.id}/featured`)
      .set(buildAuthorizationHeaders(admin.token))
      .send({ featured: true })
    expect(featured.status).toBe(200)
    expect(featured.body.data.featured).toBe(true)

    const featuredFeed = await request(testApp)
      .get(`/api/v1/shared-content?language=${language}&featuredOnly=true`)
      .set(buildAuthorizationHeaders(owner.token))
    expect(featuredFeed.body.data.map((row: { id: string }) => row.id)).toEqual([entry!.id])

    const removed = await request(testApp)
      .post(`/api/v1/shared-content/admin/entries/${entry!.id}/remove`)
      .set(buildAuthorizationHeaders(admin.token))
      .send({ reason: 'copyright takedown' })
    expect(removed.status).toBe(200)
    expect(removed.body.data.status).toBe('removed')
    expect(await listEntries(owner.token, language)).toEqual([])

    const adminList = await request(testApp)
      .get('/api/v1/shared-content/admin/entries')
      .set(buildAuthorizationHeaders(admin.token))
    expect(adminList.status).toBe(200)
    expect((adminList.body.data as { id: string; status: string }[]).find((row) => row.id === entry!.id)?.status).toBe(
      'removed'
    )

    // Moderation isn't blind: the admin still opens the tombstoned entry's
    // detail — full text, status, and the removal reason — while a normal
    // user 404s on the same id.
    const removedDetail = await request(testApp)
      .get(`/api/v1/shared-content/${entry!.id}/detail`)
      .set(buildAuthorizationHeaders(admin.token))
    expect(removedDetail.status).toBe(200)
    expect(removedDetail.body.data.status).toBe('removed')
    expect(removedDetail.body.data.removedReason).toBe('copyright takedown')
    expect(removedDetail.body.data.segmentCount).toBeGreaterThanOrEqual(1)
    const outsiderDetail = await request(testApp)
      .get(`/api/v1/shared-content/${entry!.id}/detail`)
      .set(buildAuthorizationHeaders(outsider.token))
    expect(outsiderDetail.status).toBe(404)

    // Tombstone: the owner cannot re-share, and the toggle reads unmanageable.
    const reshare = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: true })
    expect(reshare.status).toBe(403)

    // A second entry, unshared by its owner: the admin detail shows the
    // status (no removal reason to show), the normal user still 404s.
    const otherLanguage = uniqueLanguage()
    const second = await createSharedPasteSession(owner.token, otherLanguage, true)
    await expect.poll(async () => (await listEntries(owner.token, otherLanguage)).length, { timeout: 5000 }).toBe(1)
    const [secondEntry] = await listEntries(owner.token, otherLanguage)
    await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId: second.textTrackId, shared: false })
    const unsharedDetail = await request(testApp)
      .get(`/api/v1/shared-content/${secondEntry!.id}/detail`)
      .set(buildAuthorizationHeaders(admin.token))
    expect(unsharedDetail.status).toBe(200)
    expect(unsharedDetail.body.data.status).toBe('unshared')
    expect(unsharedDetail.body.data.text).toContain(second.pasteText)
    const outsiderUnshared = await request(testApp)
      .get(`/api/v1/shared-content/${secondEntry!.id}/detail`)
      .set(buildAuthorizationHeaders(outsider.token))
    expect(outsiderUnshared.status).toBe(404)

    // The adminList status filter runs server-side; assertions are keyed to
    // this test's entries (the shared DB holds other tests' rows too).
    const filtered = async (status: string) => {
      const response = await request(testApp)
        .get(`/api/v1/shared-content/admin/entries?status=${status}`)
        .set(buildAuthorizationHeaders(admin.token))
      expect(response.status).toBe(200)
      return (response.body.data as { id: string }[]).map((row) => row.id)
    }
    expect(await filtered('removed')).toContain(entry!.id)
    expect(await filtered('removed')).not.toContain(secondEntry!.id)
    expect(await filtered('unshared')).toContain(secondEntry!.id)
    expect(await filtered('unshared')).not.toContain(entry!.id)
    expect(await filtered('live')).not.toContain(entry!.id)
    expect(await filtered('live')).not.toContain(secondEntry!.id)
  })

  test('a flagged paste never publishes even when the owner opted in', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const language = uniqueLanguage()

    const sourceResponse = await request(testApp)
      .post('/api/v1/content-sources/text')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ title: __generateUniqueId('shared-flagged'), language })
    const contentSourceId = sourceResponse.body.data.id as string
    const trackResponse = await request(testApp)
      .post('/api/v1/text-tracks/paste')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ contentSourceId, language, text: `${uniquePasteText()} flagme flagme flagme flagme flagme` })
    expect(trackResponse.status).toBe(201)
    const textTrackId = trackResponse.body.data.track.id as string

    const sessionResponse = await request(testApp)
      .post('/api/v1/study-sessions')
      .set(buildAuthorizationHeaders(owner.token))
      .send({
        contentSourceId,
        textTrackId,
        nativeLanguage: 'en',
        targetLanguage: language,
        cefrLevel: 'B1',
        shareToExplore: true,
      })
    expect(sessionResponse.status).toBe(201)

    // Explicit toggle attempt surfaces the moderation refusal…
    const toggleOn = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: true })
    expect(toggleOn.status).toBe(409)
    // …and nothing ever reached the feed.
    expect(await listEntries(owner.token, language)).toEqual([])

    // Toggling off first creates an opt-out ROW for the flagged track; the
    // reshare path must re-run the eligibility gate rather than blindly flip
    // the existing row live.
    const toggleOff = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: false })
    expect(toggleOff.status).toBe(200)
    const reshareAttempt = await request(testApp)
      .put('/api/v1/shared-content/share-state')
      .set(buildAuthorizationHeaders(owner.token))
      .send({ textTrackId, shared: true })
    expect(reshareAttempt.status).toBe(409)
    expect(await listEntries(owner.token, language)).toEqual([])
  })

  test('guests cannot share their own content', async () => {
    const { token: guestToken } = await __getAnonymousSupabaseToken()
    const language = uniqueLanguage()
    const { textTrackId } = await createSharedPasteSession(guestToken, language, true)

    const state = await request(testApp)
      .get(`/api/v1/shared-content/share-state?textTrackId=${textTrackId}`)
      .set(buildAuthorizationHeaders(guestToken))
    expect(state.body.data.state).toBe('not-shareable')
    expect(await listEntries(guestToken, language)).toEqual([])
  })

  test('foreign personal sources reject direct session creation and track imports', async () => {
    const owner = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: owner.token, referral: null })
    const language = uniqueLanguage()
    // NOT shared — the UUIDs exist but there is no live entry.
    const { contentSourceId, textTrackId } = await createSharedPasteSession(owner.token, language, false)

    const intruder = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: intruder.token, referral: null })

    const createAttempt = await request(testApp)
      .post('/api/v1/study-sessions')
      .set(buildAuthorizationHeaders(intruder.token))
      .send({
        contentSourceId,
        textTrackId,
        nativeLanguage: 'en',
        targetLanguage: language,
        cefrLevel: 'B1',
      })
    expect(createAttempt.status).toBe(400)

    const importAttempt = await request(testApp)
      .post('/api/v1/text-tracks/paste')
      .set(buildAuthorizationHeaders(intruder.token))
      .send({ contentSourceId, language, text: `${uniquePasteText()} intruder edition with extra characters` })
    expect(importAttempt.status).toBe(400)

    // The same guard covers every track importer, not just paste.
    const srtAttempt = await request(testApp)
      .post('/api/v1/text-tracks/upload')
      .set(buildAuthorizationHeaders(intruder.token))
      .send({
        contentSourceId,
        language,
        srtContent: '1\n00:00:01,000 --> 00:00:02,000\nEindringling\n',
      })
    expect(srtAttempt.status).toBe(400)
  })
})
