import { describe, expect, it } from 'vitest'
import { composeGermanCitation, deriveFormDisplay, germanArticle, isNotableGenitive } from './german-noun-forms'

describe('germanArticle', () => {
  it('maps gender to der/die/das', () => {
    expect(germanArticle('m')).toBe('der')
    expect(germanArticle('f')).toBe('die')
    expect(germanArticle('n')).toBe('das')
  })
  it('returns null for common gender and unknown values', () => {
    expect(germanArticle('c')).toBeNull()
    expect(germanArticle(undefined)).toBeNull()
    expect(germanArticle('x')).toBeNull()
  })
})

describe('deriveFormDisplay', () => {
  it('returns a clean suffix when the form merely appends', () => {
    expect(deriveFormDisplay('Bestandteil', 'Bestandteile')).toEqual({ kind: 'suffix', text: '-e' })
  })
  it('returns the full form on umlaut / stem change', () => {
    expect(deriveFormDisplay('Haus', 'Häuser')).toEqual({ kind: 'full', text: 'Häuser' })
  })
  it('uses the em-dash placeholder when the form is identical', () => {
    expect(deriveFormDisplay('Fenster', 'Fenster')).toEqual({ kind: 'suffix', text: '—' })
  })
})

describe('isNotableGenitive', () => {
  it('hides feminine genitives', () => {
    expect(isNotableGenitive('f', 'Frau', 'Frau')).toBe(false)
  })
  it('hides the predictable masc/neut -(e)s', () => {
    expect(isNotableGenitive('m', 'Bestandteil', 'Bestandteils')).toBe(false)
    expect(isNotableGenitive('n', 'Haus', 'Hauses')).toBe(false)
  })
  it('shows weak -(e)n and mixed -ns', () => {
    expect(isNotableGenitive('m', 'Junge', 'Jungen')).toBe(true)
    expect(isNotableGenitive('m', 'Name', 'Namens')).toBe(true)
  })
})

describe('composeGermanCitation', () => {
  const de = (headword: string, grammar: Record<string, unknown>) =>
    composeGermanCitation({ headword, grammar, targetLanguage: 'de' })

  it('articles a regular masculine noun with a suffix plural', () => {
    expect(de('Bestandteil', { pos: 'noun', gender: 'm', plural: 'Bestandteile', genitive: 'Bestandteils' })).toEqual({
      title: 'der Bestandteil',
      forms: 'pl -e',
    })
  })

  it('uses the plural article for an irregular plural and hides the predictable genitive', () => {
    expect(de('Haus', { pos: 'noun', gender: 'n', plural: 'Häuser', genitive: 'Hauses' })).toEqual({
      title: 'das Haus',
      forms: 'die Häuser',
    })
  })

  it('hides a feminine genitive', () => {
    expect(de('Frau', { pos: 'noun', gender: 'f', plural: 'Frauen', genitive: 'Frau' })).toEqual({
      title: 'die Frau',
      forms: 'pl -en',
    })
  })

  it('shows a weak-masculine genitive', () => {
    expect(de('Junge', { pos: 'noun', gender: 'm', plural: 'Jungen', genitive: 'Jungen', is_weak_noun: true })).toEqual(
      {
        title: 'der Junge',
        forms: 'pl -n, Gen. -n',
      }
    )
  })

  it('shows a mixed -ns genitive', () => {
    expect(de('Name', { pos: 'noun', gender: 'm', plural: 'Namen', genitive: 'Namens' })).toEqual({
      title: 'der Name',
      forms: 'pl -n, Gen. -ns',
    })
  })

  it('falls back to the bare headword for a non-German noun', () => {
    expect(
      composeGermanCitation({ headword: 'день', grammar: { pos: 'noun', gender: 'm' }, targetLanguage: 'ru' })
    ).toEqual({ title: 'день', forms: null })
  })

  it('prefers display_form in the non-German fallback', () => {
    expect(
      composeGermanCitation({ headword: 'видеть', grammar: { display_form: 'ви́деть' }, targetLanguage: 'ru' })
    ).toEqual({ title: 'ви́деть', forms: null })
  })

  it('falls back to the bare headword for a German verb (no article)', () => {
    expect(de('aufstehen', { pos: 'verb', is_separable: true, auxiliary: 'sein' })).toEqual({
      title: 'aufstehen',
      forms: null,
    })
  })

  it('falls back when gender is missing', () => {
    expect(de('Ding', { pos: 'noun' })).toEqual({ title: 'Ding', forms: null })
  })
})
