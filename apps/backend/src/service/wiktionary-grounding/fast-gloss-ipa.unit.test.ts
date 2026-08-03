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
  listPronunciationEntriesByHeadwordAndPos: vi.fn(async () => []),
  listPronunciationEntriesByHeadword: vi.fn(async () => []),
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
    ).resolves.toEqual({ ipa: { ga: '/ˈɡɹædʒuət/' }, lemma: null })
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
    ).resolves.toEqual({ ipa: { ga: '/ˈɡɹædʒueɪt/' }, lemma: null })
  })

  it('returns null for an ambiguous English word without a mappable POS', async () => {
    const repo = mockRepository({
      listPronunciationEntriesByHeadword: vi.fn(async () => [
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
    ).resolves.toEqual({ ipa: { untagged: '/sɐˈbakə/' }, lemma: null })
  })

  it('labels the lemma when a non-English form falls back to its lemma pronunciation', async () => {
    // behoben (past participle) has no IPA of its own in Wiktionary; it form-of
    // resolves to beheben, whose pronunciation we surface — but labeled as the
    // lemma so the inflected form is not implied to be pronounced that way.
    const beheben = entry(1, 'beheben', 'verb', '/bəˈheːbn̩/')
    const repo = mockRepository({
      findFormOfLemma: vi.fn(async ({ headword }) => (headword === 'behoben' ? 'beheben' : null)),
      findRealLemmaByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'beheben' && pos === 'verb' ? beheben : null
      ),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'de',
        selectionText: 'behoben',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { untagged: '/bəˈheːbn̩/' }, lemma: 'beheben' })
  })

  it('uses exact Russian surface pronunciation before a wrong-POS form fallback', async () => {
    const surface = entry(1, 'поздно', 'adv', '[ˈpoznə]')
    const adjective = entry(2, 'поздний', 'adj', '[ˈpozʲnʲɪj]')
    const repo = mockRepository({
      listPronunciationEntriesByHeadword: vi.fn(async ({ headword }) => (headword === 'поздно' ? [surface] : [])),
      findRealLemmaByFormAndPos: vi.fn(async ({ form, pos }) =>
        form === 'поздно' && pos === 'adj' ? adjective : null
      ),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'ru',
        selectionText: 'поздно',
        pos: 'adjective',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { untagged: '[ˈpoznə]' }, lemma: null })
  })

  it('tries lowercase Russian surface candidates for sentence-initial selections', async () => {
    const surface = entry(1, 'господин', 'noun', '[ɡəspɐˈdʲin]')
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'господин' && pos === 'noun' ? [surface] : []
      ),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'ru',
        selectionText: 'Господин',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { untagged: '[ɡəspɐˈdʲin]' }, lemma: null })
  })

  it('uses surface-form pronunciation for English form-of entries', async () => {
    const children = entry(1, 'children', 'noun', '/ˈt͡ʃɪldɹən/', ['General-American'])
    const child = entry(2, 'child', 'noun', '/tʃaɪld/', ['General-American'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'children' && pos === 'noun' ? [children] : []
      ),
      findRealLemmaByHeadwordAndPos: vi.fn(async () => child),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'children',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/ˈt͡ʃɪldɹən/' }, lemma: null })
    expect(repo.findRealLemmaByHeadwordAndPos).not.toHaveBeenCalled()
  })

  it('does not fall back to lemma IPA for an English inflected form with a Wiktionary form mapping', async () => {
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
    ).resolves.toBeNull()
  })

  it('uses surface-form pronunciation for irregular English verb forms', async () => {
    const were = entry(1, 'were', 'verb', '/wɝ/', ['General-American'])
    const be = entry(2, 'be', 'verb', '/bi/', ['General-American'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'were' && pos === 'verb' ? [were] : []
      ),
      findRealLemmaByHeadwordAndPos: vi.fn(async () => be),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'were',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/wɝ/' }, lemma: null })
  })

  it('tries lowercase English surface candidates for sentence-initial inflections', async () => {
    const thousands = entry(1, 'thousands', 'noun', '/ˈθaʊzəndz/', ['General-American'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'thousands' && pos === 'noun' ? [thousands] : []
      ),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'Thousands',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/ˈθaʊzəndz/' }, lemma: null })
  })

  it('uses surface entries without head templates', async () => {
    const well = entry(1, 'Well', 'intj', '/wɛl/', ['General-American'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'Well' && pos === 'intj' ? [well] : []
      ),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'Well',
        pos: 'interjection',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/wɛl/' }, lemma: null })
  })

  it('accepts broad US pronunciation rows even when another broad region is also listed', async () => {
    const supplant = entry(1, 'supplant', 'verb', '/səˈplænt/', ['US', 'Canada'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async () => [supplant]),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'supplant',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/səˈplænt/' }, lemma: null })
  })

  it('tries lowercase English candidates for sentence-initial selections', async () => {
    const verb = entry(1, 'show', 'verb', '/ʃoʊ/', ['General-American'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async ({ headword, pos }) =>
        headword === 'show' && pos === 'verb' ? [verb] : []
      ),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'Show',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/ʃoʊ/' }, lemma: null })
  })

  it('keeps direct unambiguous English surface lookups working without POS', async () => {
    const sweet = entry(1, 'sweet', 'adj', '/swiːt/', ['General-American'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadword: vi.fn(async () => [sweet]),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'sweet',
        pos: null,
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/swiːt/' }, lemma: null })
  })

  it('merges multiple POS-matched surface pronunciation entries', async () => {
    const weakWe = entry(1, 'we', 'pron', '/wi/', ['General-American'])
    const strongWe = entry(2, 'we', 'pron', '/wiː/', ['Received-Pronunciation'])
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async () => [weakWe, strongWe]),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'we',
        pos: 'pronoun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { ga: '/wi/', rp: '/wiː/' }, lemma: null })
  })

  it('uses POS-only Wiktionary pronunciation tags for surface entries like rebuild', async () => {
    const rebuildVerb: DbWiktionaryEntry = {
      id: 1,
      headword: 'rebuild',
      pos: 'verb',
      data: {
        sounds: [
          { ipa: '/ɹiːˈbɪld/', tags: ['verb'] },
          { ipa: '/ˈɹiːbɪld/', tags: ['noun'] },
        ],
      },
    }
    const repo = mockRepository({
      listPronunciationEntriesByHeadwordAndPos: vi.fn(async () => [rebuildVerb]),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'rebuild',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { untagged: '/ɹiːˈbɪld/' }, lemma: null })
  })

  it('maps common verb subtypes from the fast gloss POS line', async () => {
    const verb = entry(1, 'defeat', 'verb', '/dɪˈfiːt/')
    const repo = mockRepository({
      findRealLemmaByHeadwordAndPos: vi.fn(async ({ pos }) => (pos === 'verb' ? verb : null)),
    })

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'en',
        selectionText: 'defeat',
        pos: 'transitive verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toEqual({ ipa: { untagged: '/dɪˈfiːt/' }, lemma: null })
  })

  it('returns null without hitting the repository for unsupported languages', async () => {
    const repo = mockRepository()

    await expect(
      lookupFastGlossIpa({
        targetLanguage: 'ja',
        selectionText: '犬',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toBeNull()
    expect(repo.findRealLemmaByHeadwordAndPos).not.toHaveBeenCalled()
  })
})
