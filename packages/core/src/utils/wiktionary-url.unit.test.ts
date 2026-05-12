import { describe, expect, it } from 'vitest'
import { buildWiktionaryUrl, normalizeWiktionaryHeadword } from './wiktionary-url'

describe('normalizeWiktionaryHeadword', () => {
  it('strips leading "to " from English verbs', () => {
    expect(normalizeWiktionaryHeadword('to stink', 'en', 'verb')).toBe('stink')
    expect(normalizeWiktionaryHeadword('To Run', 'en', 'verb')).toBe('Run')
  })

  it('leaves English non-verbs alone', () => {
    expect(normalizeWiktionaryHeadword('to-do', 'en', 'noun')).toBe('to-do')
    expect(normalizeWiktionaryHeadword('to', 'en', 'preposition')).toBe('to')
  })

  it('does not touch non-English headwords', () => {
    expect(normalizeWiktionaryHeadword('to stink', 'ru', 'verb')).toBe('to stink')
  })

  it('trims whitespace', () => {
    expect(normalizeWiktionaryHeadword('  hello  ', 'en')).toBe('hello')
  })
})

describe('buildWiktionaryUrl', () => {
  it('builds an English-section anchor for English entries', () => {
    expect(buildWiktionaryUrl('to stink', 'en', 'verb')).toBe('https://en.wiktionary.org/wiki/stink#English')
  })

  it('builds a Russian-section anchor with percent-encoding', () => {
    expect(buildWiktionaryUrl('слушание', 'ru', 'noun')).toBe(
      `https://en.wiktionary.org/wiki/${encodeURIComponent('слушание')}#Russian`
    )
  })

  it('falls back to the uppercased code for unknown languages', () => {
    expect(buildWiktionaryUrl('foo', 'xx', null)).toBe('https://en.wiktionary.org/wiki/foo#XX')
  })

  it('returns null when the headword is empty after normalization', () => {
    expect(buildWiktionaryUrl('   ', 'en')).toBeNull()
  })
})
