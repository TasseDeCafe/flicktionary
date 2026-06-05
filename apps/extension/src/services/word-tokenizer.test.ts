import { describe, expect, it } from 'vitest'
import { tokenizeText } from './word-tokenizer.ts'

// The substrings of the tokens marked as words, in order.
const words = (text: string) =>
  tokenizeText(text)
    .filter((t) => t.isWord)
    .map((t) => t.text)

describe('tokenizeText', () => {
  it('keeps Portuguese diacritics inside a single word token (painéis, águia)', () => {
    expect(words('painéis')).toEqual(['painéis'])
    expect(words('A águia voou.')).toEqual(['A', 'águia', 'voou'])
  })

  it('keeps German umlauts inside a single word token', () => {
    expect(words('Schöne Grüße Mädchen')).toEqual(['Schöne', 'Grüße', 'Mädchen'])
  })

  it('produces clickable word tokens for Korean Hangul', () => {
    const result = words('안녕하세요 세계')
    // The old regex matched no Hangul at all — here every word is non-empty.
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.every((w) => w.length > 0)).toBe(true)
    expect(result.join('')).toBe('안녕하세요세계')
  })

  it('still tokenizes Cyrillic and Latin', () => {
    expect(words('Привет, мир!')).toEqual(['Привет', 'мир'])
    expect(words("don't stop")).toEqual(["don't", 'stop'])
  })

  it('concatenated token text equals the input (contiguous, full coverage)', () => {
    const inputs = [
      'painéis',
      'A águia voou.',
      'Schöne Grüße',
      '안녕하세요 세계',
      'Привет, мир!',
      '  leading/trailing  ',
    ]
    for (const input of inputs) {
      expect(
        tokenizeText(input)
          .map((t) => t.text)
          .join('')
      ).toBe(input)
    }
  })

  it('returns no tokens for empty text', () => {
    expect(tokenizeText('')).toEqual([])
  })
})
