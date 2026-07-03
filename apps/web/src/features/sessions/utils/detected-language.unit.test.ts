import { describe, expect, test } from 'vitest'
import { shouldUseDetectedLanguage } from './detected-language'

describe('shouldUseDetectedLanguage', () => {
  test('applies a detection that differs from the current selection', () => {
    expect(shouldUseDetectedLanguage({ detectedCode: 'de', currentLanguage: 'en', languageTouched: false })).toBe(true)
  })

  test('applies a detection when nothing is selected yet', () => {
    expect(shouldUseDetectedLanguage({ detectedCode: 'de', currentLanguage: null, languageTouched: false })).toBe(true)
  })

  test('a manual pick always wins over detection', () => {
    expect(shouldUseDetectedLanguage({ detectedCode: 'de', currentLanguage: 'en', languageTouched: true })).toBe(false)
  })

  test('a detection matching the current selection is a no-op', () => {
    expect(shouldUseDetectedLanguage({ detectedCode: 'en', currentLanguage: 'en', languageTouched: false })).toBe(false)
  })

  test('missing or empty detection never applies', () => {
    expect(shouldUseDetectedLanguage({ detectedCode: null, currentLanguage: 'en', languageTouched: false })).toBe(false)
    expect(shouldUseDetectedLanguage({ detectedCode: undefined, currentLanguage: 'en', languageTouched: false })).toBe(
      false
    )
    expect(shouldUseDetectedLanguage({ detectedCode: '', currentLanguage: 'en', languageTouched: false })).toBe(false)
  })
})
