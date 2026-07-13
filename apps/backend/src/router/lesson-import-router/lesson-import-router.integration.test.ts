import { describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'

// Drives the oRPC contract over real HTTP through buildApp. Extraction is a
// background job (the worker owns the LLM call — see the enrichment-worker
// integration test), so the router surface itself is LLM-free: every method
// on the unscripted MockAnthropicPasses would throw if a handler called one.
// Golden path + one auth failure + one domain failure.
describe('lesson-import-router', () => {
  const testApp = buildTestApp({ anthropicPasses: MockAnthropicPasses() })

  const onboardedUser = async () => {
    const created = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: created.token, referral: null })
    return created
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/lesson-import/batches')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ targetLanguage: 'de', sourceTitle: 'Lesson notes', rawText: 'der Tisch — the table' })

    expect(response.status).toBe(401)
  })

  test('golden path: creates an extracting batch, resumes it by content hash, and polls it', async () => {
    const { token } = await onboardedUser()
    // Unique per test run: batch identity is the content hash per (user,
    // language), and the never-reset test DB keeps old batches around.
    const rawText = `der Tisch — the table (${__generateUniqueId('lesson')})`

    const created = await request(testApp)
      .post('/api/v1/lesson-import/batches')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'de', sourceTitle: 'Lesson notes', rawText })
    expect(created.status).toBe(200)
    expect(created.body.data.resumed).toBe(false)
    expect(created.body.data.batch).toMatchObject({ status: 'extracting', targetLanguage: 'de' })
    const batchId = created.body.data.batch.id

    // Re-uploading the same text resumes the existing draft.
    const resumed = await request(testApp)
      .post('/api/v1/lesson-import/batches')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'de', sourceTitle: 'Lesson notes', rawText })
    expect(resumed.status).toBe(200)
    expect(resumed.body.data).toMatchObject({ resumed: true, batch: { id: batchId } })

    // Poll shape while extraction is pending: no rows yet.
    const polled = await request(testApp)
      .get(`/api/v1/lesson-import/batches/${batchId}`)
      .set(buildAuthorizationHeaders(token))
    expect(polled.status).toBe(200)
    expect(polled.body.data.batch.status).toBe('extracting')
    expect(polled.body.data.rows).toEqual([])
  })

  test('golden path: upserts and lists teacher profiles', async () => {
    const { token } = await onboardedUser()

    const upserted = await request(testApp)
      .post('/api/v1/lesson-import/profiles')
      .set(buildAuthorizationHeaders(token))
      .send({ name: 'Yulia', language: 'ru', profileText: 'Two-column table, errors in bold.' })
    expect(upserted.status).toBe(200)
    expect(upserted.body.data.profile).toMatchObject({ name: 'Yulia', language: 'ru' })

    const listed = await request(testApp).get('/api/v1/lesson-import/profiles').set(buildAuthorizationHeaders(token))
    expect(listed.status).toBe(200)
    expect(listed.body.data.profiles).toEqual([upserted.body.data.profile])
  })

  test('returns 409 when confirming a batch that is still extracting', async () => {
    // Fully onboarded (native language + CEFR): the prefs preconditions are
    // checked before batch readiness, so only a complete user reaches the 409.
    const { id, token } = await onboardedUser()
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'de', 'B1')
    const created = await request(testApp)
      .post('/api/v1/lesson-import/batches')
      .set(buildAuthorizationHeaders(token))
      .send({
        targetLanguage: 'de',
        sourceTitle: 'Lesson notes',
        rawText: `die Katze — the cat (${__generateUniqueId('lesson')})`,
      })
    expect(created.status).toBe(200)

    const confirmed = await request(testApp)
      .post(`/api/v1/lesson-import/batches/${created.body.data.batch.id}/confirm`)
      .set(buildAuthorizationHeaders(token))
      .send({ decisions: [] })

    expect(confirmed.status).toBe(409)
  })
})
