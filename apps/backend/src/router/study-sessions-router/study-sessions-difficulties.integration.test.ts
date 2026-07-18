import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'crypto'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { KnownLemmasRepository } from '../../transport/database/known-lemmas/known-lemmas-repository'
import { TextTrackLemmaProfilesRepository } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { sql } from '../../transport/database/postgres-client'
import {
  createReadingSession,
  patchRecognitionFacet,
  saveAdhocTerm,
  setupCheckpointUser,
  uniqueCyrillicSuffix,
} from './checkpoint-test-helpers'

// The batched difficulty read over real HTTP. NOTE on failure coverage: this
// endpoint has NO genuine domain failure by design — missing/foreign/deleted
// ids are silently omitted from the result map, and unsupported sessions are
// a 200 status value, so the failure cases here are the 401 and the
// over-cap input (contract validation, 400), plus the pending/failed
// lifecycle statuses.
describe('study-sessions difficulties', () => {
  const basicDataPass = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({ basicDataPass: basicDataPass as never }),
  })
  const profilesRepository = TextTrackLemmaProfilesRepository()
  const knownLemmasRepository = KnownLemmasRepository()

  // The supported gate needs a build-manifest row for ru; the shared test DB
  // is never reset, so an idempotent insert is safe across parallel files.
  const ensureRuManifest = async () => {
    await sql`
      INSERT INTO public.lemma_rank_builds (target_language, version, wordfreq_version, row_count, mass_matched_pct)
      VALUES ('ru', 1, 'test', 0, 99)
      ON CONFLICT (target_language) DO NOTHING
    `
  }

  const getDifficulties = async (token: string, sessionIds: string[]) =>
    request(testApp)
      .post('/api/v1/study-sessions/difficulties')
      .set(buildAuthorizationHeaders(token))
      .send({ sessionIds })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/study-sessions/difficulties')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ sessionIds: [randomUUID()] })
    expect(response.status).toBe(401)
  })

  test('rejects an over-cap id list (contract validation — deliberately NOT a domain failure)', async () => {
    const { token } = await setupCheckpointUser(testApp)
    const response = await getDifficulties(
      token,
      Array.from({ length: 101 }, () => randomUUID())
    )
    expect(response.status).toBe(400)
  })

  test('golden path: blends known/scheduled/saved-not-started/unknown with pinned count semantics', async () => {
    await ensureRuManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const s = uniqueCyrillicSuffix()
    const knownLemma = `изв${s}`
    const scheduledLemma = `сх${s}`
    const savedNewLemma = `сн${s}`
    const unknownFrequent = `нч${s}`
    const unknownRare = `нр${s}`

    // A scheduled (review-state) term and a saved-but-never-started term.
    const scheduledLookupId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', scheduledLemma, 'sense')
    await patchRecognitionFacet(scheduledLookupId, { state: 'review', dueOffsetDays: 3 })
    await saveAdhocTerm(testApp, token, basicDataPass, 'ru', savedNewLemma, 'sense')

    await knownLemmasRepository.bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [knownLemma],
      source: 'bulk_text',
      sourceId: null,
    })

    await sql`
      INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
      VALUES ('ru', ${unknownFrequent}, 100, 0.01), ('ru', ${unknownRare}, 40000, 0.000001)
    `

    await profilesRepository.replaceProfile({
      textTrackId: session.text_track_id,
      rows: [
        { foldedToken: `${knownLemma}е`, tokenCount: 4, candidateLemmas: [knownLemma] },
        { foldedToken: scheduledLemma, tokenCount: 2, candidateLemmas: [scheduledLemma] },
        { foldedToken: savedNewLemma, tokenCount: 2, candidateLemmas: [savedNewLemma] },
        { foldedToken: unknownFrequent, tokenCount: 1, candidateLemmas: [unknownFrequent] },
        { foldedToken: unknownRare, tokenCount: 1, candidateLemmas: [unknownRare] },
      ],
      segmentCount: 0,
      maxSegmentIndex: null,
      wordTokenCount: 10,
      matchedTokenCount: 10,
    })

    const response = await getDifficulties(token, [session.id])
    expect(response.status).toBe(200)
    const dto = response.body.data.difficulties[session.id]
    expect(dto.status).toBe('available')
    // Covered mass = 4×1 (known) + 2×retrievability (scheduled, ~0.5–0.97) +
    // 0 (saved-not-started is deliberately 0) + 0 (unknown), over 10 tokens.
    expect(dto.expectedCoveragePercent).toBeGreaterThanOrEqual(45)
    expect(dto.expectedCoveragePercent).toBeLessThanOrEqual(60)
    expect(dto.label).toBe('frustrating')
    expect(dto.unknownLemmaCount).toBe(2)
    expect(dto.frequentUnknownCount).toBe(1)
    expect(dto.savedNotStartedCount).toBe(1)
    expect(dto.knownLemmaCount).toBe(1)
  })

  test('dedupes repeated ids; foreign and unknown ids are omitted from the map', async () => {
    await ensureRuManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const { userId: otherUserId } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const foreignSession = await createReadingSession(otherUserId, 'ru')

    const s = uniqueCyrillicSuffix()
    await profilesRepository.replaceProfile({
      textTrackId: session.text_track_id,
      rows: [{ foldedToken: `сл${s}`, tokenCount: 1, candidateLemmas: [`сл${s}`] }],
      segmentCount: 0,
      maxSegmentIndex: null,
      wordTokenCount: 1,
      matchedTokenCount: 1,
    })

    const missingId = randomUUID()
    const response = await getDifficulties(token, [session.id, session.id, foreignSession.id, missingId])
    expect(response.status).toBe(200)
    const map = response.body.data.difficulties
    expect(Object.keys(map)).toEqual([session.id])
    expect(map[session.id].status).toBe('available')
    expect(map[session.id].unknownLemmaCount).toBe(1)
  })

  test('unsupported language reports unsupported (a 200 status, not an error)', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, 'es', 'B1')
    const session = await createReadingSession(userId, 'es')

    const response = await getDifficulties(token, [session.id])
    expect(response.status).toBe(200)
    expect(response.body.data.difficulties[session.id]).toEqual({
      status: 'unsupported',
      expectedCoveragePercent: null,
      label: null,
      unknownLemmaCount: null,
      frequentUnknownCount: null,
      savedNotStartedCount: null,
      knownLemmaCount: null,
    })
  })

  test('missing profile reports pending and enqueues exactly one build job', async () => {
    await ensureRuManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')

    const first = await getDifficulties(token, [session.id])
    expect(first.body.data.difficulties[session.id].status).toBe('pending')
    const second = await getDifficulties(token, [session.id])
    expect(second.body.data.difficulties[session.id].status).toBe('pending')

    const jobs = await sql`
      SELECT id FROM public.processing_jobs
      WHERE text_track_id = ${session.text_track_id} AND kind = 'build_track_lemma_profile'
    `
    expect(jobs).toHaveLength(1)
  })

  test('a terminally failed build reports failed and is never auto-requeued', async () => {
    await ensureRuManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    await sql`
      INSERT INTO public.processing_jobs (kind, study_session_id, text_track_id, user_id, status)
      VALUES ('build_track_lemma_profile', NULL, ${session.text_track_id}, ${userId}, 'failed')
    `

    const response = await getDifficulties(token, [session.id])
    expect(response.body.data.difficulties[session.id].status).toBe('failed')

    const jobs = await sql`
      SELECT id FROM public.processing_jobs
      WHERE text_track_id = ${session.text_track_id} AND kind = 'build_track_lemma_profile'
    `
    expect(jobs).toHaveLength(1)
  })
})
