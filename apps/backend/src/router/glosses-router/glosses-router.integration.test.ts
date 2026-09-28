import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { KnownLemmasRepository } from '../../transport/database/known-lemmas/known-lemmas-repository'
import { sql } from '../../transport/database/postgres-client'

// Drives the oRPC contract over real HTTP through buildApp, with the LLM seam
// scripted via AppDependencies.anthropicPasses — the wiring/auth/DTO layer that
// pass-level unit tests cannot see. Golden path + one auth failure; exhaustive
// scenarios stay in the unit tests.
describe('glosses-router', () => {
  const fastGlossPass = vi.fn().mockResolvedValue({ gloss: 'the table', pos: 'noun', register: null })
  const languageDetectionPass = vi.fn().mockResolvedValue('de')
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      fastGlossPass: fastGlossPass as never,
      languageDetectionPass: languageDetectionPass as never,
    }),
  })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.' })

    expect(response.status).toBe(401)
  })

  test('golden path: glosses a selection, detecting the text language when the client omits it', async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')

    const response = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set({ Authorization: `Bearer ${token}` })
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.' })

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      gloss: 'the table',
      pos: 'noun',
      register: null,
      ipa: null,
      ipaDisplay: null,
      ipaLemma: null,
      knownLemmaCandidates: [],
      wordFamily: null,
    })
    // The gloss language is the language of the text, resolved by detection —
    // never the user's primary study language.
    expect(languageDetectionPass).toHaveBeenCalledWith('Der Tisch ist groß.')
    expect(fastGlossPass).toHaveBeenCalledWith({
      targetLanguage: 'de',
      nativeLanguage: 'en',
      hideTranslationFields: false,
      contextLine: 'Der Tisch ist groß.',
      selectionText: 'Tisch',
    })
  })

  test('word-family line: structure + known anchor on request, gated by the per-language setting', async () => {
    // Random Cyrillic suffix: the shared test DB is never reset, and the
    // selection must stay a single Russian word token.
    const cyrillic = 'абвгдежзиклмнопрстуфхцчшщ'
    const u = Array.from({ length: 10 }, () => cyrillic[Math.floor(Math.random() * cyrillic.length)]).join('')
    const word = `укрыть${u}`
    const root = `крыть${u}`
    await sql`
      INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
      VALUES
        ('ru', ${word}, 'verb', ${sql.json({
          head_templates: [{ name: 'ru-verb' }],
          senses: [{ glosses: ['to cover'] }],
          etymology_templates: [{ name: 'af', args: { '1': 'ru', '2': 'у-', '3': root } }],
        })}),
        ('ru', ${root}, 'verb', ${sql.json({ head_templates: [{ name: 'ru-verb' }], senses: [{ glosses: ['to roof'] }] })})
    `
    await sql`
      INSERT INTO public.wiktionary_word_family_edges (target_language, lemma, lemma_pos, relative, kind, depth)
      VALUES ('ru', ${word}, 'verb', ${root}, 'ancestor', 1)
    `
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'ru', 'B1')
    await KnownLemmasRepository().bulkMarkKnown({
      userId: id,
      targetLanguage: 'ru',
      lemmas: [root],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })
    fastGlossPass.mockResolvedValueOnce({ gloss: 'to cover', pos: 'verb', register: null })

    const gloss = (includeWordFamily?: boolean) =>
      request(testApp)
        .post('/api/v1/glosses/fast-gloss')
        .set({ Authorization: `Bearer ${token}` })
        .send({ selectionText: word, contextLine: `Он хотел ${word} её.`, targetLanguage: 'ru', includeWordFamily })

    const response = await gloss(true)
    expect(response.status).toBe(200)
    expect(response.body.data.wordFamily).toEqual({
      formOf: null,
      parts: [
        { text: 'у-', isAffix: true },
        { text: root, isAffix: false },
      ],
      anchors: [{ lemma: root, source: 'known' }],
    })

    // Not requested (extension hovers, practice lookups) → never computed.
    expect((await gloss()).body.data.wordFamily).toBeNull()

    await UserTargetLanguagePrefsRepository().setWordFamilyHintsEnabled(id, 'ru', false)
    expect((await gloss(true)).body.data.wordFamily).toBeNull()
  })

  test('golden path for a guest: an anonymous user provisioned via putUser can gloss', async () => {
    // Anonymous tokens only pass the auth middleware with the kill switch on;
    // pin it so the test doesn't depend on the environment's default.
    const guestApp = buildTestApp({
      anthropicPasses: MockAnthropicPasses({
        fastGlossPass: fastGlossPass as never,
        languageDetectionPass: languageDetectionPass as never,
      }),
      isGuestModeEnabled: true,
    })
    const { token } = await __getAnonymousSupabaseToken()

    // The extension's guest mint provisions through the same endpoint: the
    // isAnonymous branch seeds the native language and marks onboarding done.
    const provisionResponse = await request(guestApp)
      .put('/api/v1/users/me')
      .set(buildAuthorizationHeaders(token))
      .send({ referral: null, nativeLanguage: 'en' })
    expect(provisionResponse.status).toBe(200)

    const response = await request(guestApp)
      .post('/api/v1/glosses/fast-gloss')
      .set(buildAuthorizationHeaders(token))
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.', targetLanguage: 'de' })

    expect(response.status).toBe(200)
    expect(response.body.data.gloss).toBe('the table')
  })

  test('returns 400 when the user has no native language yet', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const response = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set({ Authorization: `Bearer ${token}` })
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.', targetLanguage: 'de' })

    expect(response.status).toBe(400)
  })
})
