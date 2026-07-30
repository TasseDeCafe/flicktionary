import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { UserLookupsRepository } from '../../transport/database/user-lookups/user-lookups-repository'
import { PracticeExercisesRepository } from '../../transport/database/practice-exercises/practice-exercises-repository'
import { PracticeRatingEventsRepository } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { ImportBatchesRepository } from '../../transport/database/import-batches/import-batches-repository'

// Minimal scripted basicDataPass row for the adhoc save that seeds a kept
// term (see cards-router.integration.test.ts for the convention).
const scriptedChunk = {
  source: 'highlight' as const,
  headword: 'gato',
  sense: 'animal',
  surfaceForm: 'gato',
  segmentId: 'rebound-to-the-real-segment',
  translation: 'cat',
  surfaceTranslation: null,
  definition: 'felino doméstico',
  targetExample: 'El gato duerme.',
  nativeExample: 'The cat sleeps.',
  grammar: { pos: 'noun' },
  belowCefr: false,
  zipf: 4.2,
}

describe('user-prefs-router', async () => {
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: vi.fn().mockResolvedValue([scriptedChunk]) as never,
      languageDetectionPass: vi.fn().mockResolvedValue('de') as never,
      moderationPass: vi.fn().mockResolvedValue({ verdict: 'allow' }) as never,
    }),
  })

  const createUserAndGetToken = async (): Promise<string> => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    expect(createResponse.status).toBe(200)
    return token
  }

  // An onboarded user (native language + CEFR rows) — the precondition for
  // creating sessions and adhoc cards.
  const createOnboardedUser = async (): Promise<{ id: string; token: string }> => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    expect(createResponse.status).toBe(200)
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'es', 'B1')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'de', 'B1')
    return { id, token }
  }

  const getStatus = async (token: string) => {
    const response = await request(testApp)
      .get('/api/v1/user-prefs/getting-started-status')
      .set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
    return response.body.data as { hasSession: boolean; hasSavedWords: boolean; hasPracticed: boolean }
  }

  // Adhoc save → kept user_lookup (count > 0) + its synthetic adhoc session.
  const keepAdhocTerm = async (token: string): Promise<string> => {
    const created = await request(testApp).post('/api/v1/cards/adhoc').set(buildAuthorizationHeaders(token)).send({
      targetLanguage: 'es',
      headword: 'gato',
      context: null,
    })
    expect(created.status).toBe(200)
    const card = await request(testApp)
      .get(`/api/v1/cards/${created.body.data.cardId}`)
      .set(buildAuthorizationHeaders(token))
    expect(card.status).toBe(200)
    return card.body.data.userLookupId as string
  }

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
    expect(response.body.data.accountFlags).toEqual([])
  })

  test('addAccountFlag round-trips through getPrefs and re-adding is idempotent', async () => {
    const token = await createUserAndGetToken()

    const added = await request(testApp)
      .put('/api/v1/user-prefs/account-flags')
      .send({ flag: 'getting_started_dismissed' })
      .set(buildAuthorizationHeaders(token))
    expect(added.status).toBe(200)
    expect(added.body.data.accountFlags).toEqual(['getting_started_dismissed'])

    const again = await request(testApp)
      .put('/api/v1/user-prefs/account-flags')
      .send({ flag: 'getting_started_dismissed' })
      .set(buildAuthorizationHeaders(token))
    expect(again.status).toBe(200)
    expect(again.body.data.accountFlags).toEqual(['getting_started_dismissed'])

    const second = await request(testApp)
      .put('/api/v1/user-prefs/account-flags')
      .send({ flag: 'extension_installed' })
      .set(buildAuthorizationHeaders(token))
    expect(second.status).toBe(200)
    expect(second.body.data.accountFlags).toEqual(['getting_started_dismissed', 'extension_installed'])

    const fetched = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(fetched.body.data.accountFlags).toEqual(['getting_started_dismissed', 'extension_installed'])
  })

  test('rejects an unknown account flag', async () => {
    const token = await createUserAndGetToken()

    const response = await request(testApp)
      .put('/api/v1/user-prefs/account-flags')
      .send({ flag: 'not_a_flag' })
      .set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(400)

    const fetched = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(fetched.body.data.accountFlags).toEqual([])
  })

  test('new endpoints return 401 when unauthenticated', async () => {
    const status = await request(testApp)
      .get('/api/v1/user-prefs/getting-started-status')
      .set({ Authorization: 'Bearer wrong-token' })
    expect(status.status).toBe(401)

    const flag = await request(testApp)
      .put('/api/v1/user-prefs/account-flags')
      .send({ flag: 'getting_started_dismissed' })
      .set({ Authorization: 'Bearer wrong-token' })
    expect(flag.status).toBe(401)
  })

  test('getting-started status is all false for a fresh user', async () => {
    const token = await createUserAndGetToken()

    expect(await getStatus(token)).toEqual({ hasSession: false, hasSavedWords: false, hasPracticed: false })
  })

  test('an eagerly created lookup (count = 0) does not count as saved words; a kept adhoc term does — without counting as a session', async () => {
    const { id, token } = await createOnboardedUser()

    // Eager row: exists before any keep, count = 0 — must not flip the signal.
    await UserLookupsRepository().findOrCreate({ userId: id, targetLanguage: 'es', headword: 'perro', sense: 'animal' })
    expect(await getStatus(token)).toMatchObject({ hasSavedWords: false })

    await keepAdhocTerm(token)

    // The adhoc save keeps the term AND creates a synthetic adhoc session,
    // which the Sessions list hides — hasSession must stay false.
    expect(await getStatus(token)).toEqual({ hasSession: false, hasSavedWords: true, hasPracticed: false })
  })

  test('hasSession tracks list visibility: true after importing a text, false again after soft-deleting it', async () => {
    const { token } = await createOnboardedUser()

    const imported = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Ein Text', text: 'Der Tisch ist groß.' })
    expect(imported.status).toBe(200)
    expect(await getStatus(token)).toMatchObject({ hasSession: true })

    const deleted = await request(testApp)
      .delete(`/api/v1/study-sessions/${imported.body.data.sessionId}`)
      .set(buildAuthorizationHeaders(token))
    expect(deleted.status).toBe(200)
    expect(await getStatus(token)).toMatchObject({ hasSession: false })
  })

  test('a live flashcard rating flips hasPracticed', async () => {
    const { token } = await createOnboardedUser()
    const userLookupId = await keepAdhocTerm(token)

    const rated = await request(testApp)
      .post(`/api/v1/practice/review-terms/${userLookupId}/ratings`)
      .set(buildAuthorizationHeaders(token))
      .send({ rating: 'good', pool: 'recognition', skill: 'meaning_recognition', targetForm: '' })
    expect(rated.status).toBe(201)

    expect(await getStatus(token)).toMatchObject({ hasPracticed: true })
  })

  test('an answered (used) exercise flips hasPracticed even with zero rating events', async () => {
    const { id, token } = await createOnboardedUser()
    const userLookupId = await keepAdhocTerm(token)

    // Exercise-first warm-up path: reserve → generate → ready → consumed on
    // answer. srs_reps stays 0 throughout, which is exactly why hasPracticed
    // cannot be derived from FSRS state.
    const exercisesRepository = PracticeExercisesRepository()
    const [slot] = await exercisesRepository.reserveSlots({
      userId: id,
      userLookupId,
      targetLanguage: 'es',
      pool: 'recognition',
      types: ['mc_comprehension'],
    })
    expect(slot).toBeDefined()
    const claim = await exercisesRepository.claimGenerating(slot!.id)
    expect(claim).not.toBeNull()
    await exercisesRepository.markReady({
      id: slot!.id,
      token: claim!.token,
      payload: { question: 'q', options: ['a', 'b'] },
      gateEligible: true,
      generationWarning: null,
    })
    expect(await getStatus(token)).toMatchObject({ hasPracticed: false })

    const consumed = await exercisesRepository.consumeExercise(slot!.id)
    expect(consumed?.used_at).not.toBeNull()

    expect(await getStatus(token)).toMatchObject({ hasPracticed: true })
  })

  test('lesson-import lapse events do not count as practicing', async () => {
    const { id, token } = await createOnboardedUser()
    const userLookupId = await keepAdhocTerm(token)

    const batch = await ImportBatchesRepository().insertBatch({
      userId: id,
      targetLanguage: 'es',
      teacherProfileId: null,
      sourceTitle: 'Lesson notes',
      rawText: `unique-${userLookupId}`,
      inputHash: `hash-${userLookupId}`,
      moderation: null,
    })
    expect(batch).not.toBeNull()

    // The implicit 'again' lapse a confirmed import applies — carries the
    // batch id and must not read as the user having practiced.
    await PracticeRatingEventsRepository().insert({
      userId: id,
      userLookupId,
      targetLanguage: 'es',
      pool: 'recognition',
      skill: 'meaning_recognition',
      targetForm: '',
      rating: 'again',
      wasExplicit: false,
      wasIntroduction: false,
      causedParking: false,
      practiceTextId: null,
      importBatchId: batch!.id,
      headword: 'gato',
      sense: 'animal',
      prevSrsState: null,
      prevSrsDue: null,
      prevSrsStability: null,
      prevSrsDifficulty: null,
      prevSrsLastReview: null,
      prevSrsReps: null,
      prevSrsLapses: null,
      prevSrsLearningSteps: null,
    })

    expect(await getStatus(token)).toMatchObject({ hasPracticed: false })
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

  test('ipa dialects default per language and setIpaDialect round-trips each one', async () => {
    const token = await createUserAndGetToken()

    const fresh = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(fresh.status).toBe(200)
    expect(fresh.body.data.englishIpaDialect).toBe('ga')
    expect(fresh.body.data.spanishIpaDialect).toBe('lam')
    expect(fresh.body.data.portugueseIpaDialect).toBe('br')

    const setRp = await request(testApp)
      .put('/api/v1/user-prefs/ipa-dialect')
      .send({ targetLanguage: 'en', dialect: 'rp' })
      .set(buildAuthorizationHeaders(token))
    expect(setRp.status).toBe(200)
    expect(setRp.body.data.englishIpaDialect).toBe('rp')

    const setCas = await request(testApp)
      .put('/api/v1/user-prefs/ipa-dialect')
      .send({ targetLanguage: 'es', dialect: 'cas' })
      .set(buildAuthorizationHeaders(token))
    expect(setCas.status).toBe(200)
    expect(setCas.body.data.spanishIpaDialect).toBe('cas')

    const setEu = await request(testApp)
      .put('/api/v1/user-prefs/ipa-dialect')
      .send({ targetLanguage: 'pt', dialect: 'eu' })
      .set(buildAuthorizationHeaders(token))
    expect(setEu.status).toBe(200)
    expect(setEu.body.data.portugueseIpaDialect).toBe('eu')

    const fetched = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(fetched.body.data.englishIpaDialect).toBe('rp')
    expect(fetched.body.data.spanishIpaDialect).toBe('cas')
    expect(fetched.body.data.portugueseIpaDialect).toBe('eu')
  })

  test('setIpaDialect rejects a dialect that belongs to another language', async () => {
    const token = await createUserAndGetToken()

    // `ga` is an English bucket — the discriminated union must refuse it for es.
    const wrongDialect = await request(testApp)
      .put('/api/v1/user-prefs/ipa-dialect')
      .send({ targetLanguage: 'es', dialect: 'ga' })
      .set(buildAuthorizationHeaders(token))
    expect(wrongDialect.status).toBe(400)

    // Languages without a dialect split are not settable at all.
    const wrongLanguage = await request(testApp)
      .put('/api/v1/user-prefs/ipa-dialect')
      .send({ targetLanguage: 'ru', dialect: 'ga' })
      .set(buildAuthorizationHeaders(token))
    expect(wrongLanguage.status).toBe(400)

    const fetched = await request(testApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
    expect(fetched.body.data.spanishIpaDialect).toBe('lam')
  })

  test('setIpaDialect returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .put('/api/v1/user-prefs/ipa-dialect')
      .send({ targetLanguage: 'en', dialect: 'rp' })
      .set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
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
