import { describe, expect, it } from 'vitest'
import { parseToolResult, type PracticeChunkInput } from './generate-practice-text'

const reqChunks: PracticeChunkInput[] = [
  {
    headword: 'aprovechar',
    sense: 'to take advantage of',
    translation: 'to take advantage of',
    definition: 'usar algo en beneficio propio',
    targetExample: 'Aprovechó la mañana.',
    nativeExample: 'He took advantage of the morning.',
  },
  {
    headword: 'a punto de',
    sense: 'about to',
    translation: 'about to',
    definition: 'a punto de hacer algo',
    targetExample: 'Estaba a punto de salir.',
    nativeExample: 'He was about to leave.',
  },
]

describe('parseToolResult', () => {
  it('locates surface_form in body and computes offsets server-side', () => {
    const body = 'Ayer aprovechó la mañana para limpiar la casa. Estaba a punto de cerrar.'
    const result = parseToolResult(
      body,
      {
        used_chunks: [
          { headword: 'aprovechar', sense: 'to take advantage of', surface_form: 'aprovechó' },
          { headword: 'a punto de', sense: 'about to', surface_form: 'a punto de' },
        ],
        skipped_chunks: [],
      },
      reqChunks
    )
    expect(result.usedChunks).toHaveLength(2)
    expect(result.usedChunks[0]).toMatchObject({
      headword: 'aprovechar',
      surfaceForm: 'aprovechó',
      charStart: 5,
      charEnd: 14,
    })
    expect(body.slice(result.usedChunks[0]!.charStart, result.usedChunks[0]!.charEnd)).toBe('aprovechó')
    expect(body.slice(result.usedChunks[1]!.charStart, result.usedChunks[1]!.charEnd)).toBe('a punto de')
    expect(result.generationWarning).toBeNull()
  })

  it('drops annotations whose surface_form is not a substring of body', () => {
    const body = 'Body that contains nothing relevant.'
    const result = parseToolResult(
      body,
      {
        used_chunks: [{ headword: 'aprovechar', sense: 'to take advantage of', surface_form: 'aprovechó' }],
        skipped_chunks: [],
      },
      reqChunks
    )
    expect(result.usedChunks).toHaveLength(0)
    expect(result.generationWarning).toMatch(/not in body/)
  })

  it('drops annotations whose (headword, sense) was not requested', () => {
    const body = 'Algo inesperado aquí.'
    const result = parseToolResult(
      body,
      {
        used_chunks: [{ headword: 'inesperado', sense: 'unexpected', surface_form: 'inesperado' }],
        skipped_chunks: [],
      },
      reqChunks
    )
    expect(result.usedChunks).toHaveLength(0)
    expect(result.generationWarning).toMatch(/unrequested/)
  })

  it('handles repeated surface forms by claiming non-overlapping positions', () => {
    // 'aprovechó' appears twice; we have two requested instances? No — the
    // server picks the first free occurrence per requested chunk. Here we
    // request only one and the LLM submits one, so it lands on the first
    // occurrence.
    const body = 'Aprovechó la mañana. Más tarde aprovechó la tarde.'
    const result = parseToolResult(
      body,
      {
        used_chunks: [{ headword: 'aprovechar', sense: 'to take advantage of', surface_form: 'aprovechó' }],
        skipped_chunks: [],
      },
      reqChunks
    )
    expect(result.usedChunks).toHaveLength(1)
    // First occurrence wins (case-sensitive, 'Aprovechó' at start does NOT
    // match lowercase 'aprovechó'). So the second occurrence is selected.
    expect(result.usedChunks[0]!.charStart).toBe(body.indexOf('aprovechó'))
  })

  it('preserves skipped_chunks verbatim', () => {
    const result = parseToolResult(
      'Body that uses none of the chunks.',
      {
        used_chunks: [],
        skipped_chunks: [
          { headword: 'aprovechar', sense: 'to take advantage of', reason: 'context-incompatible' },
          { headword: 'a punto de', sense: 'about to', reason: 'too many for length' },
        ],
      },
      reqChunks
    )
    expect(result.skippedChunks).toHaveLength(2)
    expect(result.skippedChunks[0]).toMatchObject({
      headword: 'aprovechar',
      reason: 'context-incompatible',
    })
  })
})
