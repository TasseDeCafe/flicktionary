import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  StoredWordFamilyInsight,
  WordFamilyEntry,
} from '../../transport/database/word-family/word-family-repository'
import type { WordFamilyInsightPassResult } from '../../transport/third-party/anthropic/passes/word-family-insight-pass'
import { buildWordFamily, MAX_INSIGHT_WARMS_PER_COMPOSE, warmWordFamilyInsights } from './word-family'

// The in-flight registry is module state, so every test uses its own words.

type Deferred = {
  resolve: (value: WordFamilyInsightPassResult & { model: string }) => void
  reject: (err: Error) => void
}

const verbEntry = (folded: string, pos = 'verb'): WordFamilyEntry => ({
  headword: folded,
  folded,
  pos,
  isRealLemma: true,
  data: { etymology_templates: [{ name: 'af', args: { 1: 'ru', 2: 'за-', 3: 'база' } }] },
})

const passResult = (parts: string[], meaning: string) => ({
  parts: parts.map((text) => ({ text, isAffix: text.endsWith('-') })),
  partMeanings: parts.map(() => meaning),
  missingParents: [],
  hiddenAncestors: [],
  cognates: [],
  model: 'test-model',
})

// An in-memory word_family_insights + explanations store with saveInsight's
// rule: the first breakdown wins, and an explanation is only stored when its
// parts match the stored breakdown.
const createDeps = (params: {
  nativeLanguageByUser?: Record<string, string>
  hintsEnabled?: boolean
  entries?: (foldedToken: string) => WordFamilyEntry[]
  // Pass calls resolve only when the test says so.
  deferPass?: boolean
}) => {
  const breakdowns = new Map<string, StoredWordFamilyInsight['parts']>()
  const explanations = new Map<string, { partMeanings: Array<string | null>; cognates: string[] }>()
  const saveResults: boolean[] = []
  const deferred: Deferred[] = []

  const wordFamilyInsightPass = vi.fn().mockImplementation(async (input: { headword: string }) => {
    if (!params.deferPass) return passResult(['за-', input.headword], 'meaning')
    return new Promise((resolve, reject) => deferred.push({ resolve, reject }))
  })
  const getInsight = vi
    .fn()
    .mockImplementation(
      async (key: { targetLanguage: string; lemma: string; lemmaPos: string; explanationLanguage: string }) => {
        const breakdown = breakdowns.get(`${key.lemma}|${key.lemmaPos}`)
        if (!breakdown) return null
        return {
          parts: breakdown,
          missingParents: [],
          hiddenAncestors: [],
          explanation: explanations.get(`${key.lemma}|${key.lemmaPos}|${key.explanationLanguage}`) ?? null,
        }
      }
    )
  const saveInsight = vi
    .fn()
    .mockImplementation(
      async (p: {
        lemma: string
        lemmaPos: string
        explanationLanguage: string
        parts: StoredWordFamilyInsight['parts']
        partMeanings: Array<string | null>
        cognates: string[]
      }) => {
        const key = `${p.lemma}|${p.lemmaPos}`
        if (!breakdowns.has(key)) breakdowns.set(key, p.parts)
        const stored = JSON.stringify(breakdowns.get(key)) === JSON.stringify(p.parts)
        if (stored)
          explanations.set(`${key}|${p.explanationLanguage}`, { partMeanings: p.partMeanings, cognates: p.cognates })
        saveResults.push(stored)
        return stored
      }
    )

  const deps = {
    wordFamilyRepository: {
      listEntriesForToken: vi
        .fn()
        .mockImplementation(async ({ foldedToken }: { foldedToken: string }) =>
          params.entries ? params.entries(foldedToken) : [verbEntry(foldedToken)]
        ),
      listLemmaEntries: vi.fn().mockResolvedValue([]),
      listAncestors: vi.fn().mockResolvedValue([]),
      listFamilyCandidates: vi.fn().mockResolvedValue([]),
      listUserVocabulary: vi.fn().mockResolvedValue([]),
      getInsight,
      saveInsight,
    },
    wiktionaryMatchRepository: { resolveDisplayHeadwords: vi.fn().mockResolvedValue(new Map()) },
    anthropicPasses: { wordFamilyInsightPass },
    usersRepository: {
      getNativeLanguage: vi
        .fn()
        .mockImplementation(async (userId: string) => params.nativeLanguageByUser?.[userId] ?? 'en'),
    },
    userTargetLanguagePrefsRepository: {
      getWordFamilyHintsEnabled: vi.fn().mockResolvedValue(params.hintsEnabled ?? true),
      getShowTranslationsEnabled: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Parameters<typeof warmWordFamilyInsights>[1]

  return { deps, wordFamilyInsightPass, getInsight, saveInsight, saveResults, deferred, explanations }
}

const warm = (
  deps: Parameters<typeof warmWordFamilyInsights>[1],
  words: Array<{ headword: string; pos?: string | null }>,
  userId = 'user-en'
) =>
  warmWordFamilyInsights(
    { userId, targetLanguage: 'ru', words: words.map((w) => ({ headword: w.headword, pos: w.pos ?? 'verb' })) },
    deps
  )

describe('warmWordFamilyInsights', () => {
  afterEach(() => vi.restoreAllMocks())

  test('generates the missing insight for a queued word', async () => {
    const { deps, wordFamilyInsightPass, explanations } = createDeps({})
    await warm(deps, [{ headword: 'гладить' }])
    await vi.waitFor(() => expect(explanations.has('гладить|verb|en')).toBe(true))
    expect(wordFamilyInsightPass).toHaveBeenCalledTimes(1)
    expect(wordFamilyInsightPass.mock.calls[0][0]).toMatchObject({ explanationLanguage: 'en', fixedParts: null })
  })

  test('does nothing when the hints are off or the language has no word-family data', async () => {
    const off = createDeps({ hintsEnabled: false })
    await warm(off.deps, [{ headword: 'бить' }])
    expect(off.getInsight).not.toHaveBeenCalled()

    const unsupported = createDeps({})
    await warmWordFamilyInsights(
      { userId: 'user-en', targetLanguage: 'it', words: [{ headword: 'parlare', pos: 'verb' }] },
      unsupported.deps
    )
    expect(unsupported.getInsight).not.toHaveBeenCalled()
  })

  test('skips cached insights, multi-word headwords and function words', async () => {
    const { deps, wordFamilyInsightPass, explanations } = createDeps({
      entries: (folded) => [verbEntry(folded, folded === 'через' ? 'prep' : 'verb')],
    })
    await warm(deps, [{ headword: 'мыть' }])
    await vi.waitFor(() => expect(explanations.has('мыть|verb|en')).toBe(true))
    wordFamilyInsightPass.mockClear()

    await warm(deps, [{ headword: 'мыть' }, { headword: 'вслед за' }, { headword: 'через', pos: null }])
    expect(wordFamilyInsightPass).not.toHaveBeenCalled()
  })

  test('a term queued in both pools is generated once', async () => {
    const { deps, wordFamilyInsightPass, explanations } = createDeps({})
    await warm(deps, [{ headword: 'лить' }, { headword: 'лить' }])
    await vi.waitFor(() => expect(explanations.has('лить|verb|en')).toBe(true))
    expect(wordFamilyInsightPass).toHaveBeenCalledTimes(1)
  })

  test(`starts at most ${MAX_INSIGHT_WARMS_PER_COMPOSE} generations per compose`, async () => {
    const { deps, wordFamilyInsightPass } = createDeps({})
    const words = Array.from({ length: MAX_INSIGHT_WARMS_PER_COMPOSE + 3 }, (_, i) => ({
      headword: `сло${'в'.repeat(i + 1)}о`,
    }))
    await warm(deps, words)
    await vi.waitFor(() => expect(wordFamilyInsightPass).toHaveBeenCalledTimes(MAX_INSIGHT_WARMS_PER_COMPOSE))
  })

  test('a word already being generated in the same language does not use up the budget', async () => {
    const { deps, deferred } = createDeps({ deferPass: true })
    await warm(deps, [{ headword: 'шить' }])
    await vi.waitFor(() => expect(deferred).toHaveLength(1))
    const others = Array.from({ length: MAX_INSIGHT_WARMS_PER_COMPOSE }, (_, i) => ({
      headword: `ши${'т'.repeat(i + 2)}ь`,
    }))
    await warm(deps, [{ headword: 'шить' }, ...others])
    await vi.waitFor(() => expect(deferred).toHaveLength(1 + MAX_INSIGHT_WARMS_PER_COMPOSE))
    deferred.forEach((d, i) => d.resolve(passResult(['за-', `w${i}`], 'sew')))
  })

  test('concurrent warmers in two languages share one breakdown', async () => {
    const { deps, wordFamilyInsightPass, deferred, saveResults, explanations } = createDeps({
      deferPass: true,
      nativeLanguageByUser: { 'user-en': 'en', 'user-fr': 'fr' },
    })
    await warm(deps, [{ headword: 'вить' }], 'user-en')
    await vi.waitFor(() => expect(deferred).toHaveLength(1))
    // The French request queues behind the English one instead of racing it.
    await warm(deps, [{ headword: 'вить' }], 'user-fr')
    expect(wordFamilyInsightPass).toHaveBeenCalledTimes(1)

    deferred[0].resolve(passResult(['за-', 'вить'], 'twist'))
    await vi.waitFor(() => expect(deferred).toHaveLength(2))
    // The second call only explains the stored parts.
    expect(wordFamilyInsightPass.mock.calls[1][0]).toMatchObject({
      explanationLanguage: 'fr',
      fixedParts: [
        { text: 'за-', isAffix: true },
        { text: 'вить', isAffix: false },
      ],
    })
    deferred[1].resolve(passResult(['за-', 'вить'], 'tordre'))
    await vi.waitFor(() => expect(explanations.has('вить|verb|fr')).toBe(true))
    expect(saveResults).toEqual([true, true])
  })

  test('a reader tap during a warm waits for it instead of paying again', async () => {
    const { deps, wordFamilyInsightPass, deferred } = createDeps({ deferPass: true })
    await warm(deps, [{ headword: 'жить' }])
    await vi.waitFor(() => expect(deferred).toHaveLength(1))

    const tap = buildWordFamily(
      {
        userId: 'user-en',
        targetLanguage: 'ru',
        explanationLanguage: 'en',
        lookup: { foldedToken: 'жить', entries: [verbEntry('жить')] },
        pos: 'verb',
        generateInsight: true,
      },
      deps
    )
    deferred[0].resolve(passResult(['за-', 'жить'], 'live'))
    const family = await tap
    expect(family?.insightPending).toBe(false)
    expect(family?.parts?.map((part) => part.meaning)).toEqual(['live', 'live'])
    expect(wordFamilyInsightPass).toHaveBeenCalledTimes(1)
  })

  test('a failed generation is logged and retried by a later compose', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { deps, wordFamilyInsightPass, deferred, explanations } = createDeps({ deferPass: true })
    await warm(deps, [{ headword: 'пить' }])
    await vi.waitFor(() => expect(deferred).toHaveLength(1))
    deferred[0].reject(new Error('overloaded'))
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('word-family insight warm-up threw', expect.anything())
    )

    await warm(deps, [{ headword: 'пить' }])
    await vi.waitFor(() => expect(deferred).toHaveLength(2))
    deferred[1].resolve(passResult(['за-', 'пить'], 'drink'))
    await vi.waitFor(() => expect(explanations.has('пить|verb|en')).toBe(true))
    expect(wordFamilyInsightPass).toHaveBeenCalledTimes(2)
  })
})
