import { describe, expect, it } from 'vitest'
import { sanitizeExplorationExtrasForLanguageMode, sanitizeTextFieldsForLanguageMode } from './language-output-guards'

describe('language output guards', () => {
  it('clears translation fields when the language mode hides them', () => {
    expect(
      sanitizeTextFieldsForLanguageMode(
        {
          translation: 'bonjour',
          nativeExample: 'hello',
          definition: 'a greeting',
        },
        { hideTranslationFields: true }
      )
    ).toEqual({
      translation: null,
      nativeExample: null,
      definition: 'a greeting',
    })
  })

  it('keeps L1 notes when a distinct native language is available', () => {
    expect(
      sanitizeExplorationExtrasForLanguageMode(
        {
          l1_notes: 'French speakers often overuse this cognate.',
          register: 'neutral',
        },
        { allowL1Notes: true }
      )
    ).toEqual({
      l1_notes: 'French speakers often overuse this cognate.',
      register: 'neutral',
    })
  })

  it('clears L1 notes when no distinct native language is available', () => {
    expect(
      sanitizeExplorationExtrasForLanguageMode({ l1_notes: 'same language note' }, { allowL1Notes: false })
    ).toEqual({
      l1_notes: null,
    })
  })
})
