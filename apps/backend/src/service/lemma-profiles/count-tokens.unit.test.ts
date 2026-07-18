import { describe, expect, it } from 'vitest'
import { countFoldedTokens } from './count-tokens'

describe('countFoldedTokens', () => {
  it('counts every occurrence, not distinct tokens', () => {
    const counts = countFoldedTokens([{ text: 'the cat and the dog and the bird' }], 'en')
    expect(counts.get('the')).toBe(3)
    expect(counts.get('and')).toBe(2)
    expect(counts.get('cat')).toBe(1)
  })

  it('folds tokens so case and orthography variants merge', () => {
    const counts = countFoldedTokens([{ text: 'Ещё раз — еще раз!' }], 'ru')
    expect(counts.get('еще')).toBe(2)
    expect(counts.get('раз')).toBe(2)
    expect(counts.has('ещё')).toBe(false)
  })

  it('accumulates across segments into the provided map', () => {
    const counts = new Map<string, number>()
    countFoldedTokens([{ text: 'hallo Welt' }], 'de', counts)
    countFoldedTokens([{ text: 'welt' }], 'de', counts)
    expect(counts.get('welt')).toBe(2)
    expect(counts.get('hallo')).toBe(1)
  })

  it('ignores punctuation and empty segments', () => {
    const counts = countFoldedTokens([{ text: '…—!!' }, { text: '' }], 'en')
    expect(counts.size).toBe(0)
  })
})
