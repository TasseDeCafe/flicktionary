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
import { CardsRepository } from '../../transport/database/cards/cards-repository'
import { UserLookupsRepository } from '../../transport/database/user-lookups/user-lookups-repository'
import { sql } from '../../transport/database/postgres-client'
import { KnownLemmasRepository } from '../../transport/database/known-lemmas/known-lemmas-repository'
import { insertStubCardForHighlight } from '../../service/processing/materialize-basic-data-chunks'

// Drives the oRPC contract over real HTTP through buildApp, with the LLM seam
// scripted via AppDependencies.anthropicPasses. Golden path + one auth failure
// + one domain failure; exhaustive scenarios stay in the unit tests.
describe('highlights-router', () => {
  const languageDetectionPass = vi.fn().mockResolvedValue('de')
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      languageDetectionPass: languageDetectionPass as never,
      moderationPass: vi.fn().mockResolvedValue({ verdict: 'allow' }) as never,
    }),
  })

  // A session with real segments, created through the import-text flow the
  // same way the extension does it.
  const createSessionWithSegments = async (
    { language, text }: { language: string; text: string } = {
      language: 'de',
      text: 'Der Tisch ist groß.\nDie Katze schläft.',
    }
  ) => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, language, 'B1')
    languageDetectionPass.mockResolvedValueOnce(language)

    const imported = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Ein Text', text })
    expect(imported.status).toBe(200)
    const { sessionId, textTrackId } = imported.body.data

    const segments = await request(testApp)
      .get(`/api/v1/text-tracks/${textTrackId}/segments`)
      .set(buildAuthorizationHeaders(token))
    expect(segments.status).toBe(200)

    return { userId: id, token, sessionId, segments: segments.body.data as Array<{ id: string; text: string }> }
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/study-sessions/6f76ff59-3d4f-4e33-a1b8-3d6b0a06f8f0/highlights')
      .set({ Authorization: 'Bearer wrong-token' })

    expect(response.status).toBe(401)
  })

  test('golden path: creates a highlight (enqueuing enrichment), lists it, and deletes it', async () => {
    const { token, sessionId, segments } = await createSessionWithSegments()
    const segment = segments[0]

    const created = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
      .send({
        sessionId,
        startSegmentId: segment.id,
        endSegmentId: segment.id,
        startOffset: 4,
        endOffset: 9,
        selectionText: 'Tisch',
        // Preview gloss already shown pre-save: persisting it means saved-mode
        // display never re-runs the fast-gloss pass.
        fastGloss: { gloss: 'the table', pos: 'noun', register: null },
      })

    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({
      studySessionId: sessionId,
      selectionText: 'Tisch',
      startOffset: 4,
      endOffset: 9,
      noteOnly: false,
    })
    const highlightId = created.body.data.id

    // The save enqueued a (debounced) background enrichment job for this
    // highlight — the session-vocabulary status endpoint reports it in flight.
    const status = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/processing-status`)
      .set(buildAuthorizationHeaders(token))
    expect(status.status).toBe(200)
    expect(status.body.data.enrichingHighlightIds).toContain(highlightId)

    const listed = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((h: { id: string }) => h.id)).toEqual([highlightId])
    expect(listed.body.data[0].fastGloss).toContain('the table')

    const deleted = await request(testApp)
      .delete(`/api/v1/study-sessions/${sessionId}/highlights/${highlightId}`)
      .set(buildAuthorizationHeaders(token))
    expect(deleted.status).toBe(200)
    expect(deleted.body.data.id).toBe(highlightId)

    const relisted = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
    expect(relisted.body.data).toEqual([])
  })

  // A full-lane card is materialized in needs_data and only auto-keeps at the
  // end of its enrich run — mid-run it must not read as a note-only stub.
  test('a needs_data card reads as note-only only once no enrichment is running', async () => {
    const { userId, token, sessionId, segments } = await createSessionWithSegments()
    const segment = segments[0]

    const created = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
      .send({
        sessionId,
        startSegmentId: segment.id,
        endSegmentId: segment.id,
        startOffset: 4,
        endOffset: 9,
        selectionText: 'Tisch',
      })
    expect(created.status).toBe(201)
    const highlightId = created.body.data.id

    // The enrich job's materialize step: card inserted in needs_data while the
    // job is still live.
    const { lookup } = await insertStubCardForHighlight(
      { sessionId, userId, targetLanguage: 'de', highlightId, segmentId: segment.id, selectionText: 'Tisch' },
      { cardsRepository: CardsRepository(), userLookupsRepository: UserLookupsRepository() }
    )

    const listHighlight = async () => {
      const listed = await request(testApp)
        .get(`/api/v1/study-sessions/${sessionId}/highlights`)
        .set(buildAuthorizationHeaders(token))
      expect(listed.status).toBe(200)
      return listed.body.data.find((h: { id: string }) => h.id === highlightId)
    }

    expect(await listHighlight()).toMatchObject({ noteOnly: false, chunkId: null })

    // Enrichment over but the card stranded in needs_data (a real stub, or a
    // failed run): offer the upgrade.
    await sql`
      UPDATE public.processing_jobs SET status = 'done'
      WHERE highlight_id = ${highlightId} AND kind = 'enrich_highlight'
    `
    expect(await listHighlight()).toMatchObject({ noteOnly: true, chunkId: lookup.id })
  })

  // The saved sheet shows the same word-family line the preview did, built
  // from the gloss persisted at Save — no second gloss pass.
  test('fastGloss on a saved highlight returns the word-family line, gated by the setting', async () => {
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
    const line = `Он хотел ${word} её.`
    const { userId, token, sessionId, segments } = await createSessionWithSegments({ language: 'ru', text: line })
    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: 'ru',
      lemmas: [root],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })

    const startOffset = line.indexOf(word)
    const created = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
      .send({
        sessionId,
        startSegmentId: segments[0].id,
        endSegmentId: segments[0].id,
        startOffset,
        endOffset: startOffset + word.length,
        selectionText: word,
        fastGloss: { gloss: 'to cover', pos: 'verb', register: null },
      })
    expect(created.status).toBe(201)
    const highlightId = created.body.data.id

    const glossSaved = () =>
      request(testApp)
        .post(`/api/v1/study-sessions/${sessionId}/highlights/${highlightId}/fast-gloss`)
        .set(buildAuthorizationHeaders(token))
        .send({})

    const response = await glossSaved()
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      gloss: 'to cover',
      pos: 'verb',
      wordFamily: {
        formOf: null,
        parts: [
          { text: 'у-', isAffix: true, meaning: null },
          { text: root, isAffix: false, meaning: null },
        ],
        anchors: [{ lemma: root, source: 'known' }],
        cognates: [],
        insightPending: true,
      },
    })

    await UserTargetLanguagePrefsRepository().setWordFamilyHintsEnabled(userId, 'ru', false)
    expect((await glossSaved()).body.data.wordFamily).toBeNull()
  })

  test("returns 404 when creating a highlight in another user's session", async () => {
    const { sessionId, segments } = await createSessionWithSegments()
    const stranger = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: stranger.token, referral: null })

    const response = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(stranger.token))
      .send({
        sessionId,
        startSegmentId: segments[0].id,
        endSegmentId: segments[0].id,
        startOffset: 0,
        endOffset: 3,
        selectionText: 'Der',
      })

    expect(response.status).toBe(404)
  })
})
