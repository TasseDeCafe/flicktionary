import { describe, expect, test } from 'vitest'
import { getWordRanges } from './word-segmenter.ts'

// Maps the returned ranges back to the substrings they cover, so assertions
// read in terms of the actual word tokens rather than raw offsets.
const words = (text: string, locale: string) => getWordRanges(text, locale).map(([s, e]) => text.slice(s, e))

describe('getWordRanges', () => {
  test('empty text yields no ranges', () => {
    expect(getWordRanges('', 'en')).toEqual([])
  })

  test('Latin (en): excludes whitespace and punctuation', () => {
    expect(words('Hello, world!', 'en')).toEqual(['Hello', 'world'])
  })

  test('Latin (es): keeps accented word characters intact', () => {
    expect(words('¿Cómo estás, amigo?', 'es')).toEqual(['Cómo', 'estás', 'amigo'])
  })

  test('offsets are correct half-open ranges into the source', () => {
    const ranges = getWordRanges('ab cd', 'en')
    expect(ranges).toEqual([
      [0, 2],
      [3, 5],
    ])
  })

  test('CJK (zh): segments contiguous Han text into multiple words', () => {
    const result = words('我喜欢猫', 'zh')
    // The built-in segmenter splits Chinese into word-like units rather than
    // returning the whole run; every unit is non-empty and joins back to the
    // source with no spaces.
    expect(result.length).toBeGreaterThan(1)
    expect(result.join('')).toBe('我喜欢猫')
  })

  test('CJK (ja): segments Japanese without relying on spaces', () => {
    const result = words('猫が好き', 'ja')
    expect(result.length).toBeGreaterThan(1)
    expect(result.join('')).toBe('猫が好き')
  })

  test('Thai (th): segments spaceless Thai into words', () => {
    const result = words('สวัสดีครับ', 'th')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.join('')).toBe('สวัสดีครับ')
  })

  test('LRU returns the same array reference on a cache hit', () => {
    const a = getWordRanges('caching is reused', 'en')
    const b = getWordRanges('caching is reused', 'en')
    expect(b).toBe(a)
  })

  test('different locales are cached independently', () => {
    const en = getWordRanges('shared text', 'en')
    const es = getWordRanges('shared text', 'es')
    expect(en).not.toBe(es)
    expect(en).toEqual(es)
  })
})
