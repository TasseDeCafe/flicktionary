import { describe, expect, test } from 'vitest'
import { isInflectionForm } from './kaikki-forms'

describe('isInflectionForm', () => {
  test('keeps untagged forms and real paradigm cells', () => {
    expect(isInflectionForm(undefined)).toBe(true)
    expect(isInflectionForm([])).toBe(true)
    expect(isInflectionForm(['genitive', 'plural'])).toBe(true)
    expect(isInflectionForm(['canonical', 'imperfective'])).toBe(true)
    expect(isInflectionForm(['imperfective', 'infinitive'])).toBe(true)
    expect(isInflectionForm(['participle', 'past', 'perfective'])).toBe(true)
  })

  test('drops kaikki metadata entries', () => {
    expect(isInflectionForm(['romanization'])).toBe(false)
    expect(isInflectionForm(['inflection-template'])).toBe(false)
    expect(isInflectionForm(['table-tags'])).toBe(false)
  })

  test('drops cross-references to another lexeme: aspect partners and auxiliaries', () => {
    expect(isInflectionForm(['perfective'])).toBe(false)
    expect(isInflectionForm(['imperfective'])).toBe(false)
    expect(isInflectionForm(['auxiliary'])).toBe(false)
  })
})
