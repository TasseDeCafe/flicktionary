import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'

describe('user-prefs-router', async () => {
  const testApp = buildTestApp()

  const createUserAndGetToken = async (): Promise<string> => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    expect(createResponse.status).toBe(200)
    return token
  }

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  test('when user is unauthenticated', async () => {
    const response = await request(testApp).get('/api/v1/user-prefs').set({ Authorization: 'Bearer wrong-token' })

    expect(response.status).toBe(401)
  })

  test('fresh user has null ui prefs', async () => {
    const token = await createUserAndGetToken()

    const response = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
    expect(response.body.data.uiTheme).toBeNull()
    expect(response.body.data.uiLanguage).toBeNull()
  })

  test('setUiTheme round-trips values including null', async () => {
    const token = await createUserAndGetToken()

    const setDark = await request(testApp)
      .put('/api/v1/user-prefs/ui-theme')
      .send({ uiTheme: 'dark' })
      .set(buildAuthorizationHeaders(token))
    expect(setDark.status).toBe(200)
    expect(setDark.body.data.uiTheme).toBe('dark')

    const getAfterDark = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(getAfterDark.body.data.uiTheme).toBe('dark')

    const setSystem = await request(testApp)
      .put('/api/v1/user-prefs/ui-theme')
      .send({ uiTheme: 'system' })
      .set(buildAuthorizationHeaders(token))
    expect(setSystem.status).toBe(200)
    expect(setSystem.body.data.uiTheme).toBe('system')

    // The NULL round-trip is load-bearing for the extension's pairing reconcile:
    // NULL means "never explicitly set", distinct from an explicit 'system'.
    const setNull = await request(testApp)
      .put('/api/v1/user-prefs/ui-theme')
      .send({ uiTheme: null })
      .set(buildAuthorizationHeaders(token))
    expect(setNull.status).toBe(200)
    expect(setNull.body.data.uiTheme).toBeNull()

    const getAfterNull = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(getAfterNull.body.data.uiTheme).toBeNull()
  })

  test('setUiLanguage round-trips values including null', async () => {
    const token = await createUserAndGetToken()

    const setFr = await request(testApp)
      .put('/api/v1/user-prefs/ui-language')
      .send({ uiLanguage: 'fr' })
      .set(buildAuthorizationHeaders(token))
    expect(setFr.status).toBe(200)
    expect(setFr.body.data.uiLanguage).toBe('fr')

    const getAfterFr = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(getAfterFr.body.data.uiLanguage).toBe('fr')

    const setNull = await request(testApp)
      .put('/api/v1/user-prefs/ui-language')
      .send({ uiLanguage: null })
      .set(buildAuthorizationHeaders(token))
    expect(setNull.status).toBe(200)
    expect(setNull.body.data.uiLanguage).toBeNull()

    const getAfterNull = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(getAfterNull.body.data.uiLanguage).toBeNull()
  })

  test('rejects invalid ui theme', async () => {
    const token = await createUserAndGetToken()

    const response = await request(testApp)
      .put('/api/v1/user-prefs/ui-theme')
      .send({ uiTheme: 'blue' })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(400)

    const getResponse = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(getResponse.body.data.uiTheme).toBeNull()
  })

  // Creates the user_target_language_prefs row (upsertCefr) the limits
  // setter requires — same precondition as setShowTranslationsForLanguage.
  const setCefr = async (token: string, targetLanguage: string) => {
    const response = await request(testApp)
      .put('/api/v1/user-prefs/cefr-for-language')
      .send({ targetLanguage, cefrLevel: 'B1' })
      .set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
  }

  test('practice limits are per language with column defaults and no global fields', async () => {
    const token = await createUserAndGetToken()
    await setCefr(token, 'es')

    const response = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
    expect(response.body.data.practiceMaxNewTerms).toBeUndefined()
    expect(response.body.data.practiceMaxReviewTerms).toBeUndefined()
    expect(response.body.data.targetLanguagePrefs).toEqual([
      expect.objectContaining({ targetLanguage: 'es', practiceMaxNewTerms: 20, practiceMaxReviewTerms: 100 }),
    ])
  })

  test('setPracticeLimitsForLanguage persists one language and leaves the others untouched', async () => {
    const token = await createUserAndGetToken()
    await setCefr(token, 'es')
    await setCefr(token, 'ru')

    const setLimits = await request(testApp)
      .put('/api/v1/user-prefs/practice-limits-for-language')
      .send({ targetLanguage: 'es', maxNewTerms: 5, maxReviewTerms: 50 })
      .set(buildAuthorizationHeaders(token))
    expect(setLimits.status).toBe(200)

    const getResponse = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    const byLanguage = new Map(
      (getResponse.body.data.targetLanguagePrefs as { targetLanguage: string }[]).map((p) => [p.targetLanguage, p])
    )
    expect(byLanguage.get('es')).toEqual(
      expect.objectContaining({ practiceMaxNewTerms: 5, practiceMaxReviewTerms: 50 })
    )
    expect(byLanguage.get('ru')).toEqual(
      expect.objectContaining({ practiceMaxNewTerms: 20, practiceMaxReviewTerms: 100 })
    )
  })

  test('rejects practice limits that disable both budgets', async () => {
    const token = await createUserAndGetToken()
    await setCefr(token, 'es')

    const response = await request(testApp)
      .put('/api/v1/user-prefs/practice-limits-for-language')
      .send({ targetLanguage: 'es', maxNewTerms: 0, maxReviewTerms: 0 })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(400)

    const getResponse = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(getResponse.body.data.targetLanguagePrefs[0]).toEqual(
      expect.objectContaining({ practiceMaxNewTerms: 20, practiceMaxReviewTerms: 100 })
    )
  })

  test('setting practice limits for a never-configured language fails (UPDATE-only, like show-translations)', async () => {
    const token = await createUserAndGetToken()

    const response = await request(testApp)
      .put('/api/v1/user-prefs/practice-limits-for-language')
      .send({ targetLanguage: 'es', maxNewTerms: 5, maxReviewTerms: 50 })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(500)
  })
})
