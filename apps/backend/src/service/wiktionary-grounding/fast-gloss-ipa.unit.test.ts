import { describe, expect, it, vi } from 'vitest'
import type { DbWiktionaryEntry } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { lookupFastGlossIpa } from './fast-gloss-ipa'

const entry = (id: number, headword: string, pos: string, ipa: string, tags: string[] = []): DbWiktionaryEntry => ({
  id,
  headword,
  pos,
  data: {
    sounds: [{ ipa, tags }],
  },
})

const mockRepository = (
  overrides: Partial<WiktionaryEntriesRepositoryInterface> = {}
): WiktionaryEntriesRepositoryInterface => ({
  findRealLemmaByHeadwordAndPos: vi.fn(async () => null),
  listRealLemmasByHeadword: vi.fn(async () => []),
  findRealLemmaByHeadword: vi.fn(async () => null),
  findFormOfLemma: vi.fn(async () => null),
  findRealLemmaByForm: vi.fn(async () => null),
  findRealLemmaByFormAndPos: vi.fn(async () => null),
  listRealLemmasByForm: vi.fn(async () => []),
  ...overrides,
})

describe('lookupFastGlossIpa', () => {
  it('uses POS to pick the noun pronunciation for an ambiguous English word', async () => {
    const nounGraduate = entry(1, 'graduate', 'noun', '/ˈɡɹædʒuət/', ['General-American'])
    const repo = mockRepository({
      findRealLemmaByHeadwordAndPos: vi.fn(async ({ pos }) => (pos === 'noun' ? nounGraduate : null)),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'graduate',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ga: '/ˈɡɹædʒuət/' })
  })

  it('uses POS to pick the verb pronunciation for an ambiguous English word', async () => {
    const verbGraduate = entry(2, 'graduate', 'verb', '/ˈɡɹædʒueɪt/', ['General-American'])
    const repo = mockRepository({
      findRealLemmaByHeadwordAndPos: vi.fn(async ({ pos }) => (pos === 'verb' ? verbGraduate : null)),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'graduate',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ga: '/ˈɡɹædʒueɪt/' })
  })

  it('returns null for an ambiguous English word without a mappable POS', async () => {
    const repo = mockRepository({
      listRealLemmasByHeadword: vi.fn(async () => [
        entry(1, 'graduate', 'noun', '/ˈɡɹædʒuət/', ['General-American']),
        entry(2, 'graduate', 'verb', '/ˈɡɹædʒueɪt/', ['General-American']),
      ]),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'graduate',
        pos: null,
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toBeNull()
  })

  it('returns Russian untagged IPA when the no-POS lookup has one candidate', async () => {
    const repo = mockRepository({
      listRealLemmasByHeadword: vi.fn(async () => [entry(1, 'собака', 'noun', '/sɐˈbakə/')]),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'ru',
        selectionText: 'собака',
        pos: null,
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ untagged: '/sɐˈbakə/' })
  })

  it('uses POS-constrained form lookup instead of broad form fallback', async () => {
    const verb = entry(1, 'graduate', 'verb', '/ˈɡɹædʒueɪt/', ['General-American'])
    const repo = mockRepository({
      findRealLemmaByFormAndPos: vi.fn(async ({ pos }) => (pos === 'verb' ? verb : null)),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'graduates',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ga: '/ˈɡɹædʒueɪt/' })
    expect(repo.findRealLemmaByFormAndPos).toHaveBeenCalledWith({
      targetLanguage: 'en',
      form: 'graduates',
      pos: 'verb',
    })
    expect(repo.findRealLemmaByForm).not.toHaveBeenCalled()
  })

  it('returns null without hitting the repository for unsupported languages', async () => {
    const repo = mockRepository()

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'es',
        selectionText: 'perro',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toBeNull()
    expect(repo.findRealLemmaByHeadwordAndPos).not.toHaveBeenCalled()
  })
})
