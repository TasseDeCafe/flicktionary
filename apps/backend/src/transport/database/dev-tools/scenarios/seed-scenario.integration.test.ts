import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../../../test/test-utils'
import { MockAnthropicPasses } from '../../../third-party/anthropic/anthropic-passes'
import { sql } from '../../postgres-client'
import { WordFamilyRepository } from '../../word-family/word-family-repository'
import { WiktionaryMatchRepository } from '../../wiktionary-entries/wiktionary-match-repository'
import { prepareScenario, seedScenario, verifyScenarioFamilies } from './seed-scenario'
import { SCENARIOS } from './scenarios'
import type { CatalogTerm, ScenarioSpec } from './scenario-spec'

// Seeds every dev scenario onto a fresh test user and checks it through the
// real API: the session-plan counts the scenario promises, a compose with no
// generating placeholders, hint availability per card, and — the point of the
// seeder — zero LLM calls. The background warmers catch and log errors (and
// exercise generation turns a throw into a failed slot), so an unscripted
// pass would be swallowed: the test counts calls instead of waiting for one
// to fail.

const generateExercisePass = vi.fn().mockRejectedValue(new Error('unexpected exercise generation'))
const verifyExercisePass = vi.fn().mockRejectedValue(new Error('unexpected exercise verification'))
const wordFamilyInsightPass = vi.fn().mockRejectedValue(new Error('unexpected insight generation'))
const anthropicPasses = MockAnthropicPasses({
  generateExercisePass: generateExercisePass as never,
  verifyExercisePass: verifyExercisePass as never,
  wordFamilyInsightPass: wordFamilyInsightPass as never,
})
const testApp = buildTestApp({ anthropicPasses })
const wordFamilyDeps = {
  wordFamilyRepository: WordFamilyRepository(),
  wiktionaryMatchRepository: WiktionaryMatchRepository(),
  anthropicPasses,
}

const freshUser = async () => {
  const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
  await __createOrGetUserWithOurApi({ testApp, token, referral: null })
  return { userId: id, token }
}

const seed = async (userId: string, spec: ScenarioSpec, requireDictionary = false) => {
  const prepared = await prepareScenario(spec, wordFamilyDeps, { requireDictionary })
  await seedScenario({ userId, prepared })
  return prepared
}

const preview = async (token: string, targetLanguage: string) => {
  const response = await request(testApp)
    .get('/api/v1/practice/queue/preview')
    .query({ targetLanguage })
    .set(buildAuthorizationHeaders(token))
  expect(response.status).toBe(200)
  return response.body.data.counts
}

// Compose's warmers are fire-and-forget: give them time to reach the passes
// (an LLM call would reserve a slot first, so also wait out in-flight slots).
const settleBackgroundWork = async (userId: string) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const [row] = (await sql`
      SELECT count(*)::int AS inflight FROM public.practice_exercises
      WHERE user_id = ${userId} AND status IN ('pending', 'generating')
    `) as [{ inflight: number }]
    if (row.inflight === 0 && attempt >= 4) return
  }
}

describe('dev scenarios', () => {
  test.each(SCENARIOS.map((spec) => [spec.name, spec] as const))(
    '%s: serves what it promises without any LLM call',
    async (_name, spec) => {
      const { userId, token } = await freshUser()
      await seed(userId, spec)
      vi.clearAllMocks()

      expect(await preview(token, spec.targetLanguage)).toEqual(spec.expectations.preview)

      const composed = await request(testApp)
        .post('/api/v1/practice/queue/compose')
        .set(buildAuthorizationHeaders(token))
        .send({ targetLanguage: spec.targetLanguage })
      expect(composed.status).toBe(200)
      const items = composed.body.data.items as Array<
        | { type: 'flashcard'; card: { userLookupId: string; headword: string; skill: string } }
        | { type: 'exercise'; entry: { status: string; headword: string } }
      >
      const { new: introductions, warmup, learning, review } = spec.expectations.preview
      expect(items).toHaveLength(introductions + warmup + learning + review)
      for (const item of items) {
        if (item.type === 'exercise') expect(item.entry).toMatchObject({ status: 'ready' })
      }

      // Hint availability follows the seeded hint slot: ready → served,
      // failed → null.
      for (const item of items) {
        if (item.type !== 'flashcard') continue
        const pool = item.card.skill === 'meaning_production' ? 'production' : 'recognition'
        const placed = spec.terms.find((candidate) => candidate.term.headword === item.card.headword)
        const hintType = pool === 'production' ? 'mc_cloze' : 'mc_comprehension'
        const hintSlot = placed?.bank?.find((slot) => slot.pool === pool && slot.type === hintType)
        expect(hintSlot, `${item.card.headword} has a ${pool} hint slot`).toBeDefined()
        const hint = await request(testApp)
          .get('/api/v1/practice/hint-exercise')
          .query({ userLookupId: item.card.userLookupId, pool })
          .set(buildAuthorizationHeaders(token))
        expect(hint.status).toBe(200)
        expect(hint.body.data.exercise === null, item.card.headword).toBe(hintSlot!.status !== 'ready')
      }

      await settleBackgroundWork(userId)
      expect(generateExercisePass).not.toHaveBeenCalled()
      expect(verifyExercisePass).not.toHaveBeenCalled()
      expect(wordFamilyInsightPass).not.toHaveBeenCalled()
    }
  )

  test('a reading scenario seeds an unread session in its own content source', async () => {
    const spec = SCENARIOS.find((candidate) => candidate.reading)!
    const { userId, token } = await freshUser()
    const prepared = await prepareScenario(spec, wordFamilyDeps, { requireDictionary: false })
    const { readingSessionId } = await seedScenario({ userId, prepared })
    expect(readingSessionId).not.toBeNull()

    const [row] = (await sql`
      SELECT s.furthest_read_segment_index, s.reviewed_until_segment_index,
        (SELECT count(*)::int FROM public.text_segments g WHERE g.text_track_id = s.text_track_id) AS segments,
        (SELECT count(*)::int FROM public.cards c
           JOIN public.study_sessions o ON o.id = c.study_session_id
          WHERE o.content_source_id = s.content_source_id) AS cards_in_source
      FROM public.study_sessions s WHERE s.id = ${readingSessionId}
    `) as [
      {
        furthest_read_segment_index: number | null
        reviewed_until_segment_index: number | null
        segments: number
        cards_in_source: number
      },
    ]
    expect(row.segments).toBe(spec.reading!.segments.length)
    expect(row.furthest_read_segment_index).toBeNull()
    expect(row.reviewed_until_segment_index).toBeNull()
    // A card in the reading's source would exclude its word from the
    // never-practiced offer.
    expect(row.cards_in_source).toBe(0)

    const candidates = await request(testApp)
      .post(`/api/v1/study-sessions/${readingSessionId}/checkpoint-candidates`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: spec.reading!.segments.length - 1, previewedSpans: [] })
    expect(candidates.status).toBe(200)

    // Reseeding replaces the reading session rather than piling up copies.
    const again = await seedScenario({ userId, prepared })
    const sessions = await sql`SELECT id FROM public.study_sessions WHERE user_id = ${userId}`
    expect(sessions).toHaveLength(2)
    expect(again.readingSessionId).not.toBe(readingSessionId)
  })

  test('reseeding resets the account to the same state and leaves other users alone', async () => {
    const [familySpec, leechSpec] = SCENARIOS
    const target = await freshUser()
    const bystander = await freshUser()
    await seed(bystander.userId, leechSpec)
    const bystanderBefore = await preview(bystander.token, 'ru')

    await seed(target.userId, leechSpec)
    await seed(target.userId, familySpec)
    expect(await preview(target.token, 'ru')).toEqual(familySpec.expectations.preview)
    await seed(target.userId, familySpec)
    expect(await preview(target.token, 'ru')).toEqual(familySpec.expectations.preview)

    const [counts] = (await sql`
      SELECT
        (SELECT count(*)::int FROM public.user_lookups WHERE user_id = ${target.userId}) AS lookups,
        (SELECT count(*)::int FROM public.study_sessions WHERE user_id = ${target.userId}) AS sessions,
        (SELECT count(*)::int FROM public.content_sources WHERE created_by_user_id = ${target.userId}) AS sources
    `) as [{ lookups: number; sessions: number; sources: number }]
    expect(counts).toEqual({ lookups: familySpec.terms.length, sessions: 1, sources: 1 })
    expect(await preview(bystander.token, 'ru')).toEqual(bystanderBefore)
  })
})

// The real ru catalog needs a kaikki load the shared test DB doesn't have, so
// the word-family path runs on a synthetic scenario: random-suffixed words
// with their own dictionary entries and edges (the shared DB is never reset).
describe('dev scenarios: word family', () => {
  const CYRILLIC = 'абвгдежзиклмнопрстуфхцчшщ'
  const uniqueSuffix = (): string =>
    Array.from({ length: 10 }, () => CYRILLIC[Math.floor(Math.random() * CYRILLIC.length)]).join('')

  const insertEntry = async (headword: string, pos: string) => {
    await sql`
      INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
      VALUES ('ru', ${headword}, ${pos}, ${sql.json({ head_templates: [{ name: 'ru-noun' }] })})
    `
  }
  const insertEdge = async (lemma: string, relative: string, kind: 'ancestor' | 'related') => {
    await sql`
      INSERT INTO public.wiktionary_word_family_edges (target_language, lemma, lemma_pos, relative, kind, depth)
      VALUES ('ru', ${lemma}, 'noun', ${relative}, ${kind}, 1)
    `
  }

  const term = (headword: string, insight?: CatalogTerm['insight']): CatalogTerm => ({
    headword,
    sense: '',
    translation: `${headword} (en)`,
    definition: null as never,
    targetExample: `Это ${headword}.`,
    nativeExample: 'This.',
    surface: headword,
    grammar: { pos: 'noun', display_form: headword },
    zipf: 4,
    exercises: {
      cloze: { sentence: `Это ${headword}.`, answer: headword, distractors: ['стол', 'стул', 'дом'] },
      comprehension: {
        sentence: `Это ${headword}.`,
        term: headword,
        prompt: 'What is it?',
        options: ['a', 'b', 'c', 'd'],
        answerIndex: 0,
      },
    },
    insight,
  })

  test('caches insights, writes anchors, and replaces a conflicting cached insight', async () => {
    const u = uniqueSuffix()
    // мастер (the card) ← мастерить (parent, known); мастерская (related, saved);
    // кот (control: no family the user has).
    const [card, parent, saved, control] = [`мастер${u}`, `мастерить${u}`, `мастерская${u}`, `кот${u}`]
    for (const word of [card, parent, saved, control]) await insertEntry(word, 'noun')
    await insertEdge(card, parent, 'ancestor')
    await insertEdge(card, saved, 'related')

    // A cached insight that hides the parent and has another breakdown: the
    // curated one must replace it, or the known anchor would never show.
    await sql`
      INSERT INTO public.word_family_insights (target_language, lemma, lemma_pos, parts, hidden_ancestors, model)
      VALUES ('ru', ${card}, 'noun', ${sql.json([{ text: card, isAffix: false }])}, ${sql.array([parent])}::text[], 'llm')
    `
    await sql`
      INSERT INTO public.word_family_insight_explanations
        (target_language, lemma, lemma_pos, explanation_language, part_meanings, cognates, model)
      VALUES ('ru', ${card}, 'noun', 'en', ${sql.json(['stale'])}, '[]'::jsonb, 'llm')
    `

    const spec: ScenarioSpec = {
      name: 'synthetic-family',
      description: '',
      targetLanguage: 'ru',
      nativeLanguage: 'en',
      cefr: 'B1',
      terms: [
        {
          term: term(card, {
            parts: [
              { text: parent, isAffix: false },
              { text: '-ø', isAffix: true },
            ],
            partMeanings: ['to craft', 'agent'],
          }),
          recognition: {
            state: 'review',
            dueInHours: -1,
            stability: 5,
            difficulty: 5,
            reps: 3,
            lapses: 0,
            lastReviewDaysAgo: 4,
            introducedDaysAgo: 10,
          },
          bank: [{ pool: 'recognition', type: 'mc_comprehension', status: 'ready' }],
          insight: 'curated',
          savedDaysAgo: 10,
        },
        {
          term: term(control, { parts: [], partMeanings: [] }),
          recognition: {
            state: 'review',
            dueInHours: -1,
            stability: 5,
            difficulty: 5,
            reps: 3,
            lapses: 0,
            lastReviewDaysAgo: 4,
            introducedDaysAgo: 10,
          },
          bank: [{ pool: 'recognition', type: 'mc_comprehension', status: 'failed' }],
          insight: 'curated',
          savedDaysAgo: 10,
        },
        // Saved relatives are scheduled far out, as in the real scenario.
        {
          term: term(saved),
          recognition: {
            state: 'review',
            dueInHours: 24 * 30,
            stability: 40,
            difficulty: 5,
            reps: 3,
            lapses: 0,
            lastReviewDaysAgo: 4,
            introducedDaysAgo: 10,
          },
          savedDaysAgo: 10,
        },
      ],
      knownLemmas: [parent],
      expectations: {
        preview: { new: 0, warmup: 0, learning: 0, review: 2 },
        familyAnchors: { [card]: [parent, saved], [control]: null },
      },
      tryIt: [],
    }

    const { userId, token } = await freshUser()
    const prepared = await seed(userId, spec, true)
    expect(await preview(token, 'ru')).toEqual(spec.expectations.preview)
    expect(await verifyScenarioFamilies({ userId, prepared }, wordFamilyDeps)).toEqual([])

    // The flashcard's own request path sees the same line.
    const response = await request(testApp)
      .post('/api/v1/glosses/word-family')
      .set(buildAuthorizationHeaders(token))
      .send({ headword: card, targetLanguage: 'ru', pos: 'noun' })
    expect(response.status).toBe(200)
    const wordFamily = response.body.data.wordFamily
    expect(wordFamily.insightPending).toBe(false)
    expect(wordFamily.parts.map((part: { meaning: string | null }) => part.meaning)).toEqual(['to craft', 'agent'])
    expect(
      wordFamily.anchors.map((anchor: { lemma: string; source: string }) => [anchor.lemma, anchor.source]).sort()
    ).toEqual(
      [
        [parent, 'known'],
        [saved, 'saved'],
      ].sort()
    )

    // Compose would warm any uncached insight — none left to warm.
    vi.clearAllMocks()
    const composed = await request(testApp)
      .post('/api/v1/practice/queue/compose')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'ru' })
    expect(composed.status).toBe(200)
    await settleBackgroundWork(userId)
    expect(wordFamilyInsightPass).not.toHaveBeenCalled()
    expect(generateExercisePass).not.toHaveBeenCalled()
  })

  test('refuses a curated insight whose word is missing from the dictionary', async () => {
    const missing = `нетслова${uniqueSuffix()}`
    const spec: ScenarioSpec = {
      ...SCENARIOS[0],
      terms: [{ term: term(missing, { parts: [], partMeanings: [] }), insight: 'curated', savedDaysAgo: 1 }],
    }
    await expect(prepareScenario(spec, wordFamilyDeps, { requireDictionary: true })).rejects.toThrow(missing)
  })
})
