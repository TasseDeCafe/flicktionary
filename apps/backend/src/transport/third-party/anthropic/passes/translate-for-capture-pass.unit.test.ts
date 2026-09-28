import { describe, expect, test } from 'vitest'
import { parseTranslateForCaptureInput } from './translate-for-capture-pass'

describe('parseTranslateForCaptureInput', () => {
  test('keeps up to three trimmed candidates and resolves the input language', () => {
    const result = parseTranslateForCaptureInput({
      input_language: ' EN ',
      candidates: [
        { headword: ' засыпать ', note: 'to fall asleep', example: 'Я засыпаю.' },
        { headword: 'заснуть', note: 'pf', example: '' },
        { headword: 'уснуть', note: 'colloquial', example: '' },
        { headword: 'отключиться', note: 'slang', example: '' },
      ],
    })
    expect(result.inputLanguage).toBe('en')
    expect(result.candidates.map((c) => c.headword)).toEqual(['засыпать', 'заснуть', 'уснуть'])
  })

  test('drops candidates without a headword and maps unknown languages to null', () => {
    const result = parseTranslateForCaptureInput({
      input_language: 'und',
      candidates: [{ headword: '  ', note: 'x', example: 'y' }, { note: 'no headword' }, null],
    })
    expect(result).toEqual({ inputLanguage: null, candidates: [] })
  })
})
