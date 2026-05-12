import { describe, expect, it, vi } from 'vitest'
import type { DbWiktionaryEntry } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { findEntry } from './lookup'

const entry = (headword: string, pos: string): DbWiktionaryEntry => ({
  id: 1,
  headword,
  pos,
  data: {},
})

const mockRepository = (
  directEntries: Map<string, DbWiktionaryEntry>
): WiktionaryEntriesRepositoryInterface => ({
  findRealLemmaByHeadwordAndPos: vi.fn(async ({ targetLanguage, headword, pos }) => {
    return directEntries.get(`${targetLanguage}:${headword}:${pos}`) ?? null
  }),
  findRealLemmaByHeadword: vi.fn(async () => null),
  findFormOfLemma: vi.fn(async () => null),
  findRealLemmaByForm: vi.fn(async () => null),
})

describe('findEntry', () => {
  it('tries an English verb headword without leading "to " under the same POS', async () => {
    const found = entry('stink', 'verb')
    const repo = mockRepository(new Map([['en:stink:verb', found]]))

    await expect(
      findEntry({
        targetLanguage: 'en',
        headword: 'to stink',
        pos: 'verb',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toBe(found)

    expect(repo.findRealLemmaByHeadwordAndPos).toHaveBeenNthCalledWith(1, {
      targetLanguage: 'en',
      headword: 'to stink',
      pos: 'verb',
    })
    expect(repo.findRealLemmaByHeadwordAndPos).toHaveBeenNthCalledWith(2, {
      targetLanguage: 'en',
      headword: 'stink',
      pos: 'verb',
    })
  })

  it('does not strip "to " for non-verb English lookups', async () => {
    const repo = mockRepository(new Map([['en:graduate:verb', entry('graduate', 'verb')]]))

    await expect(
      findEntry({
        targetLanguage: 'en',
        headword: 'to graduate',
        pos: 'noun',
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toBeNull()

    expect(repo.findRealLemmaByHeadwordAndPos).toHaveBeenCalledTimes(1)
    expect(repo.findRealLemmaByHeadwordAndPos).toHaveBeenCalledWith({
      targetLanguage: 'en',
      headword: 'to graduate',
      pos: 'noun',
    })
  })

  it('does not strip "to " without a POS signal', async () => {
    const repo = mockRepository(new Map([['en:graduate:verb', entry('graduate', 'verb')]]))

    await expect(
      findEntry({
        targetLanguage: 'en',
        headword: 'to graduate',
        pos: null,
        wiktionaryEntriesRepository: repo,
      })
    ).resolves.toBeNull()

    expect(repo.findRealLemmaByHeadwordAndPos).not.toHaveBeenCalled()
    expect(repo.findRealLemmaByHeadword).toHaveBeenCalledWith({
      targetLanguage: 'en',
      headword: 'to graduate',
    })
  })
})
