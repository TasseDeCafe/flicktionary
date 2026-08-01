import { describe, expect, test } from 'vitest'
import { countWords } from './count-words'

describe('countWords', () => {
  test('counts space-delimited words, ignoring punctuation', () => {
    expect(countWords('Der kleine Prinz kam auf einen neuen Planeten.', 'de')).toBe(8)
  })

  test('counts across newlines (subtitle-style joined text)', () => {
    expect(countWords('Привет, мир!\nКак дела?', 'ru')).toBe(4)
  })

  test('segments non-space-delimited scripts instead of returning one blob', () => {
    // Exact segmentation is ICU's business; the guarantee we need is that a
    // Japanese sentence doesn't count as a single "word".
    expect(countWords('私は学生です。', 'ja')).toBeGreaterThan(1)
  })

  test('returns zero for empty text', () => {
    expect(countWords('', 'en')).toBe(0)
  })

  test('falls back to a whitespace split on an invalid language tag', () => {
    expect(countWords('one two three', 'not a bcp47 tag!!')).toBe(3)
  })
})
