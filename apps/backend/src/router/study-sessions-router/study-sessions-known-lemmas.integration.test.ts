import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { TextTrackLemmaProfilesRepository } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { sql } from '../../transport/database/postgres-client'
import {
  createReadingSession,
  insertWiktionaryLemma,
  saveAdhocTerm,
  setupCheckpointUser,
  uniqueCyrillicSuffix,
} from './checkpoint-test-helpers'

// The known-vocabulary baseline over real HTTP: mark-known preview → sweep →
// gloss chip read path → un-mark (docs/DATA-MODEL.md "Known lemmas"). Shared
// fixtures with the checkpoint tests; profiles are seeded directly through
// the repository (the build job is covered by its own tests).
describe('study-sessions known lemmas', () => {
  const basicDataPass = vi.fn()
  const fastGlossPass = vi.fn().mockResolvedValue({ gloss: 'gloss', pos: 'noun', register: null })
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
      fastGlossPass: fastGlossPass as never,
    }),
  })
  const profilesRepository = TextTrackLemmaProfilesRepository()

  const seedProfile = async (textTrackId: string, candidateLemmasByToken: Record<string, string[]>) => {
    await profilesRepository.replaceProfile({
      textTrackId,
      rows: Object.entries(candidateLemmasByToken).map(([foldedToken, candidateLemmas]) => ({
        foldedToken,
        tokenCount: 1,
        candidateLemmas,
      })),
      segmentCount: 1,
      maxSegmentIndex: 0,
      wordTokenCount: Object.keys(candidateLemmasByToken).length,
      matchedTokenCount: Object.keys(candidateLemmasByToken).length,
    })
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/study-sessions/00000000-0000-0000-0000-000000000001/mark-known-preview')
      .set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
  })

  test('golden path: preview → sweep skips saved terms → chip reads → un-mark', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const s = uniqueCyrillicSuffix()
    const unknownA = `тарк${s}`
    const unknownB = `фонк${s}`
    const savedWord = `брон${s}`
    await insertWiktionaryLemma(unknownA, [`${unknownA}и`])

    // The saved term must be excluded from the sweep (saving is the stronger
    // signal), even though it appears among the profile candidates.
    await saveAdhocTerm(testApp, token, basicDataPass, 'ru', savedWord, 'sense')
    await seedProfile(session.text_track_id, {
      [`${unknownA}и`]: [unknownA],
      [unknownB]: [unknownB],
      [savedWord]: [savedWord],
    })

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ status: 'ready', markableLemmaCount: 2 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.status).toBe(200)
    expect(marked.body.data).toEqual({ markedCount: 2 })

    const provenance = await sql`
      SELECT lemma, source, source_id FROM public.known_lemmas
      WHERE user_id = ${userId} AND target_language = 'ru'
      ORDER BY lemma
    `
    expect(provenance).toHaveLength(2)
    expect(provenance.map((r) => r.lemma).sort()).toEqual([unknownB, unknownA].sort())
    expect(provenance[0]).toMatchObject({ source: 'bulk_text', source_id: session.id })

    // Idempotent: a second sweep has nothing left to mark.
    const remarked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(remarked.body.data).toEqual({ markedCount: 0 })

    // The gloss chip read path: an inflected occurrence of the marked lemma
    // resolves through the matcher and reports the known candidate.
    const gloss = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set(buildAuthorizationHeaders(token))
      .send({ selectionText: `${unknownA}и`, contextLine: `Вот ${unknownA}и здесь.`, targetLanguage: 'ru' })
    expect(gloss.status).toBe(200)
    expect(gloss.body.data.knownLemmaCandidates).toEqual([unknownA])

    // Un-mark removes exactly the candidates the gloss reported.
    const unmarked = await request(testApp)
      .post('/api/v1/known-lemmas/unmark')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'ru', lemmas: [unknownA] })
    expect(unmarked.status).toBe(200)
    expect(unmarked.body.data).toEqual({ removedCount: 1 })

    const previewAfter = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(previewAfter.body.data).toEqual({ status: 'ready', markableLemmaCount: 1 })
  })

  test('missing profile: preview reports pending, sweep refuses, and a build job is enqueued', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ status: 'pending', markableLemmaCount: 0 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.status).toBe(422)
    expect(marked.body.data.errors[0].code).toBe('PROFILE_PENDING')

    // Both calls funnel through the ensure gate — exactly one live job.
    const jobs = await sql`
      SELECT id FROM public.processing_jobs
      WHERE text_track_id = ${session.text_track_id} AND kind = 'build_track_lemma_profile'
    `
    expect(jobs).toHaveLength(1)
  })

  test('unsupported language: preview reports unsupported and the sweep refuses', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, 'es', 'B1')
    const session = await createReadingSession(userId, 'es')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ status: 'unsupported', markableLemmaCount: 0 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.status).toBe(422)
    expect(marked.body.data.errors[0].code).toBe('UNSUPPORTED')
  })

  test('foreign session: 404 for both preview and sweep', async () => {
    const { userId } = await setupCheckpointUser(testApp)
    const { token: otherToken } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(otherToken))
    expect(preview.status).toBe(404)

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(otherToken))
      .send({})
    expect(marked.status).toBe(404)
  })
})
