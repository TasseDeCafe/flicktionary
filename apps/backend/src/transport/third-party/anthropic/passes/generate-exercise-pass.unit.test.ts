import { describe, expect, it } from 'vitest'
import { buildMultipleChoiceOptions, locateBlank } from './generate-exercise-pass'

describe('locateBlank', () => {
  it('returns the offsets of the surface form', () => {
    expect(locateBlank('El gato duerme.', 'gato')).toEqual({ blankStart: 3, blankEnd: 7 })
  })

  it('rejects a surface form that is not in the sentence', () => {
    expect(() => locateBlank('El gato duerme.', 'perro')).toThrow(/not a substring/)
  })

  it('rejects an empty surface form', () => {
    expect(() => locateBlank('El gato duerme.', '')).toThrow(/empty surface_form/)
  })

  it('rejects a pre-blanked sentence whose surface form is the blank itself', () => {
    expect(() => locateBlank('Отпуск прошёл, ______ ______ погода испортилась.', '______ ______')).toThrow(
      /pre-blanked/
    )
  })

  it('rejects underscores in the sentence even when the surface form is clean', () => {
    expect(() => locateBlank('El ____ duerme en el gato.', 'gato')).toThrow(/pre-blanked/)
  })
})

describe('buildMultipleChoiceOptions', () => {
  it('returns four options with an answer index pointing at the exact answer', () => {
    const result = buildMultipleChoiceOptions('gato', ['perro', 'libro', 'coche'])

    expect(result.options).toHaveLength(4)
    expect(result.options[result.answerIndex]).toBe('gato')
  })

  it('rejects duplicate distractors', () => {
    expect(() => buildMultipleChoiceOptions('gato', ['perro', 'perro', 'coche'])).toThrow(
      /duplicate or answer-equivalent/
    )
  })

  it('rejects distractors equivalent to the answer after case and accent normalization', () => {
    expect(() => buildMultipleChoiceOptions('árbol', ['Arbol', 'casa', 'mesa'])).toThrow(
      /duplicate or answer-equivalent/
    )
  })

  it('rejects the wrong number of distractors', () => {
    expect(() => buildMultipleChoiceOptions('gato', ['perro', 'coche'])).toThrow(/expected 3/)
  })
})
