import { describe, expect, test } from 'vitest'
import { computeWordFamilyEdges } from './compute-word-family-edges'

describe('computeWordFamilyEdges', () => {
  test('walks ancestors transitively, capped at depth 3, each at its shortest depth', () => {
    const edges = computeWordFamilyEdges(
      [
        { lemma: 'закрываться', pos: 'verb', parents: ['закрывать'], relatedWords: [] },
        { lemma: 'закрывать', pos: 'verb', parents: ['закрыть'], relatedWords: [] },
        { lemma: 'закрыть', pos: 'verb', parents: ['крыть'], relatedWords: [] },
        { lemma: 'крыть', pos: 'verb', parents: ['кровля'], relatedWords: [] },
      ],
      []
    )
    const ancestorsOf = (lemma: string) =>
      edges.filter((e) => e.lemma === lemma && e.kind === 'ancestor').map((e) => [e.relative, e.depth])
    expect(ancestorsOf('закрываться')).toEqual([
      ['закрывать', 1],
      ['закрыть', 2],
      ['крыть', 3],
    ])
    expect(ancestorsOf('закрыть')).toEqual([
      ['крыть', 1],
      ['кровля', 2],
    ])
  })

  test('a shorter path wins over a longer one to the same ancestor', () => {
    const edges = computeWordFamilyEdges(
      [
        { lemma: 'врезаться', pos: 'verb', parents: ['врезать', 'резать'], relatedWords: [] },
        { lemma: 'врезать', pos: 'verb', parents: ['резать'], relatedWords: [] },
      ],
      []
    )
    expect(edges.find((e) => e.lemma === 'врезаться' && e.relative === 'резать')?.depth).toBe(1)
  })

  test('survives etymology cycles and never links a word to itself', () => {
    const edges = computeWordFamilyEdges(
      [
        { lemma: 'ааа', pos: 'noun', parents: ['ббб'], relatedWords: [] },
        { lemma: 'ббб', pos: 'noun', parents: ['ааа'], relatedWords: [] },
      ],
      []
    )
    expect(edges.every((e) => e.lemma !== e.relative)).toBe(true)
    expect(edges).toHaveLength(2)
  })

  test('related words need a shared stem', () => {
    const edges = computeWordFamilyEdges(
      [{ lemma: 'рукав', pos: 'noun', parents: [], relatedWords: ['рука', 'одежда', 'нарукавник'] }],
      ['на']
    )
    expect(edges.map((e) => [e.relative, e.kind])).toEqual([
      ['рука', 'related'],
      ['нарукавник', 'related'],
    ])
  })
})
