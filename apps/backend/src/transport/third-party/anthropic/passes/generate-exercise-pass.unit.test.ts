import { describe, expect, it } from 'vitest'
import { buildMultipleChoiceOptions } from './generate-exercise-pass'

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
