import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { TextTrackLemmaProfilesRepository } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { sql } from '../../transport/database/postgres-client'
import { KnownLemmasRepository } from '../../transport/database/known-lemmas/known-lemmas-repository'
import {
  appendSegment,
  createReadingSession,
  ensureRuLemmaRankManifest,
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

  // Bookkeeping must match the fixture track's REAL segments (none) — the
  // sweep shares the difficulty read's staleness check, and a mismatch would
  // re-enqueue a rebuild and report pending instead of serving the profile.
  const seedProfile = async (textTrackId: string, candidateLemmasByToken: Record<string, string[]>) => {
    await profilesRepository.replaceProfile({
      textTrackId,
      rows: Object.entries(candidateLemmasByToken).map(([foldedToken, candidateLemmas]) => ({
        foldedToken,
        tokenCount: 1,
        candidateLemmas,
      })),
      segmentCount: 0,
      maxSegmentIndex: null,
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
    await ensureRuLemmaRankManifest()
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
    expect(preview.body.data).toEqual({ status: 'ready', markableLemmaCount: 2, sessionMarkedCount: 0 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.status).toBe(200)
    expect(marked.body.data).toEqual({ markedCount: 2, sweepBatchId: expect.any(String) })

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
    expect(remarked.body.data).toEqual({ markedCount: 0, sweepBatchId: null })

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
    expect(previewAfter.body.data).toEqual({ status: 'ready', markableLemmaCount: 1, sessionMarkedCount: 1 })
  })

  test('span sweeps accumulate across sittings and never depend on the profile', async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const s = uniqueCyrillicSuffix()
    const firstWord = `перв${s}`
    const secondWord = `втор${s}`
    await insertWiktionaryLemma(firstWord, [`${firstWord}ов`])
    await insertWiktionaryLemma(secondWord, [])
    // Segment 0 holds an inflected occurrence of the first lemma; segment 1
    // the second. No profile is seeded — the span path tokenizes live.
    await appendSegment(session.text_track_id, `Вот ${firstWord}ов здесь.`)
    await appendSegment(session.text_track_id, `А ${secondWord} потом.`)

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview?toSegmentIndex=0`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ status: 'ready', markableLemmaCount: 1, sessionMarkedCount: 0 })

    // First sitting: mark up to segment 0 — only the first lemma.
    const firstSweep = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 0 })
    expect(firstSweep.status).toBe(200)
    expect(firstSweep.body.data).toEqual({ markedCount: 1, sweepBatchId: expect.any(String) })
    const afterFirst = await sql`
      SELECT lemma FROM public.known_lemmas WHERE user_id = ${userId} AND target_language = 'ru'
    `
    expect(afterFirst.map((r) => r.lemma)).toEqual([firstWord])

    // Second sitting further in (index clamped past the end): the overlap
    // with sitting one is free, only the new lemma is inserted.
    const secondSweep = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 99 })
    expect(secondSweep.body.data).toEqual({ markedCount: 1, sweepBatchId: expect.any(String) })
    const afterSecond = await sql`
      SELECT lemma FROM public.known_lemmas WHERE user_id = ${userId} AND target_language = 'ru' ORDER BY lemma
    `
    expect(afterSecond.map((r) => r.lemma).sort()).toEqual([secondWord, firstWord].sort())

    // Re-sweeping the same span is a no-op.
    const resweep = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 1 })
    expect(resweep.body.data).toEqual({ markedCount: 0, sweepBatchId: null })
  })

  test('whole-text sweep drops unranked homograph siblings; chip/un-mark still reach historical junk', async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const s = uniqueCyrillicSuffix()
    const rankedWord = `наст${s}`
    const junkSibling = `хлам${s}`
    const soleRare = `редк${s}`
    // The junk entry claims the ranked word's surface form (the becuz/because
    // shape), so the chip's live resolution sees both candidates.
    await insertWiktionaryLemma(rankedWord, [])
    await insertWiktionaryLemma(junkSibling, [rankedWord])
    await sql`
      INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
      VALUES ('ru', ${rankedWord}, 12345, 0.00001)
    `
    await seedProfile(session.text_track_id, {
      [rankedWord]: [rankedWord, junkSibling],
      [soleRare]: [soleRare],
      [`гоу${s}`]: [`${rankedWord} ${junkSibling}`],
    })

    // Ranked sibling wins its token; the all-unranked token keeps its sole
    // candidate; the multi-word-only token contributes nothing.
    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.body.data).toEqual({ status: 'ready', markableLemmaCount: 2, sessionMarkedCount: 0 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.body.data).toEqual({ markedCount: 2, sweepBatchId: expect.any(String) })
    const rows = await sql`
      SELECT lemma FROM public.known_lemmas WHERE user_id = ${userId} AND target_language = 'ru' ORDER BY lemma
    `
    expect(rows.map((r) => r.lemma).sort()).toEqual([rankedWord, soleRare].sort())

    // A pre-filtering sweep left a junk row behind: the chip's correction
    // path stays unfiltered, so un-mark can still delete it.
    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [junkSibling],
      source: 'bulk_text',
      sourceId: session.id,
      sweepBatchId: null,
    })
    const gloss = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set(buildAuthorizationHeaders(token))
      .send({ selectionText: rankedWord, contextLine: `Вот ${rankedWord} тут.`, targetLanguage: 'ru' })
    expect(gloss.body.data.knownLemmaCandidates).toEqual([rankedWord, junkSibling].sort())

    const unmarked = await request(testApp)
      .post('/api/v1/known-lemmas/unmark')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'ru', lemmas: gloss.body.data.knownLemmaCandidates })
    expect(unmarked.body.data).toEqual({ removedCount: 2 })
  })

  test('span sweep drops unranked homograph siblings of a live-resolved token', async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const s = uniqueCyrillicSuffix()
    const rankedWord = `верн${s}`
    const junkSibling = `мусор${s}`
    // Both entries own the same inflected form — the live span resolution
    // returns both as candidates of one token.
    await insertWiktionaryLemma(rankedWord, [`${rankedWord}ов`])
    await insertWiktionaryLemma(junkSibling, [`${rankedWord}ов`])
    await sql`
      INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
      VALUES ('ru', ${rankedWord}, 23456, 0.00001)
    `
    await appendSegment(session.text_track_id, `Вот ${rankedWord}ов здесь.`)

    const sweep = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 0 })
    expect(sweep.body.data).toEqual({ markedCount: 1, sweepBatchId: expect.any(String) })
    const rows = await sql`
      SELECT lemma FROM public.known_lemmas WHERE user_id = ${userId} AND target_language = 'ru'
    `
    expect(rows.map((r) => r.lemma)).toEqual([rankedWord])
  })

  test('a kaikki language without a ranks manifest is unsupported for preview and sweep', async () => {
    // de has wiktionary data but (in this test DB) no lemma_rank_builds row —
    // the sweep must refuse like the difficulty stat does, or the creditable
    // filter's no-ranks pass-through would mark every homograph. If a future
    // test seeds a de manifest, this test must move to a synthetic language.
    const { userId, token } = await setupCheckpointUser(testApp)
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, 'de', 'B1')
    const session = await createReadingSession(userId, 'de')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.body.data).toEqual({ status: 'unsupported', markableLemmaCount: 0, sessionMarkedCount: 0 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.status).toBe(422)
    expect(marked.body.data.errors[0].code).toBe('UNSUPPORTED')
  })

  test('sweep-exact toast undo vs session-wide un-mark, and sessionMarkedCount lifecycle', async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    const s = uniqueCyrillicSuffix()
    const firstWord = `гарм${s}`
    const secondWord = `дельт${s}`
    await insertWiktionaryLemma(firstWord, [])
    await insertWiktionaryLemma(secondWord, [])
    await appendSegment(session.text_track_id, `Вот ${firstWord} тут.`)
    await appendSegment(session.text_track_id, `А ${secondWord} там.`)

    // Two accumulating span sweeps → two distinct batches on one source_id.
    const firstSweep = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 0 })
    expect(firstSweep.body.data.markedCount).toBe(1)
    const secondSweep = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 1 })
    expect(secondSweep.body.data.markedCount).toBe(1)
    expect(secondSweep.body.data.sweepBatchId).not.toBe(firstSweep.body.data.sweepBatchId)

    // The marked count is computed for every preview status — including while
    // the whole-text profile is still pending (no profile seeded here).
    const pendingPreview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(pendingPreview.body.data).toEqual({ status: 'pending', markableLemmaCount: 0, sessionMarkedCount: 2 })

    // Undo of the SECOND press removes only its row — sweep 1's mark survives.
    const batchUndo = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/unmark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ sweepBatchId: secondSweep.body.data.sweepBatchId })
    expect(batchUndo.status).toBe(200)
    expect(batchUndo.body.data).toEqual({ removedCount: 1 })
    const afterBatchUndo = await sql`
      SELECT lemma FROM public.known_lemmas WHERE user_id = ${userId} AND target_language = 'ru'
    `
    expect(afterBatchUndo.map((r) => r.lemma)).toEqual([firstWord])

    // The session-wide action clears what's left.
    const sessionUndo = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/unmark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(sessionUndo.body.data).toEqual({ removedCount: 1 })
    const afterSessionUndo = await sql`
      SELECT lemma FROM public.known_lemmas WHERE user_id = ${userId} AND target_language = 'ru'
    `
    expect(afterSessionUndo).toHaveLength(0)
  })

  test('unmark-known on a foreign session is a 404', async () => {
    const { userId } = await setupCheckpointUser(testApp)
    const { token: otherToken } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')

    const response = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/unmark-known`)
      .set(buildAuthorizationHeaders(otherToken))
      .send({})
    expect(response.status).toBe(404)
  })

  test('missing profile: preview reports pending, sweep refuses, and a build job is enqueued', async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ status: 'pending', markableLemmaCount: 0, sessionMarkedCount: 0 })

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

  test('terminally failed build: preview reports failed, sweep refuses, and NO new job is enqueued', async () => {
    await ensureRuLemmaRankManifest()
    const { userId, token } = await setupCheckpointUser(testApp)
    const session = await createReadingSession(userId, 'ru')
    await sql`
      INSERT INTO public.processing_jobs (kind, study_session_id, text_track_id, user_id, status)
      VALUES ('build_track_lemma_profile', NULL, ${session.text_track_id}, ${userId}, 'failed')
    `

    // The polling client must see a terminal state — 'pending' here would
    // mean every poll mints a fresh job (the failed row is not live, so the
    // coalescing unique index no longer guards the enqueue).
    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/mark-known-preview`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ status: 'failed', markableLemmaCount: 0, sessionMarkedCount: 0 })

    const marked = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/mark-known`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(marked.status).toBe(422)
    expect(marked.body.data.errors[0].code).toBe('PROFILE_FAILED')

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
    expect(preview.body.data).toEqual({ status: 'unsupported', markableLemmaCount: 0, sessionMarkedCount: 0 })

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
