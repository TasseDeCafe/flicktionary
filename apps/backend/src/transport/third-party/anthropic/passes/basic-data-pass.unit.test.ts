import { describe, expect, it } from 'vitest'
import { parseBasicDataChunks } from './basic-data-pass'

describe('parseBasicDataChunks', () => {
  it('parses a happy-path LLM-discovered chunk', () => {
    const raw = [
      {
        source: 'llm',
        headword: 'fundirse con',
        sense: 'merge with',
        surface_form: 'se fundía con',
        segment_id: '00000000-0000-0000-0000-000000000001',
        translation: 'to merge with',
        definition: 'volverse uno con algo',
        target_example: 'El sonido se fundía con el silencio.',
        native_example: 'The sound merged with the silence.',
        below_cefr: false,
      },
    ]
    expect(parseBasicDataChunks(raw)).toEqual([
      {
        source: 'llm',
        highlightId: undefined,
        headword: 'fundirse con',
        sense: 'merge with',
        surfaceForm: 'se fundía con',
        segmentId: '00000000-0000-0000-0000-000000000001',
        translation: 'to merge with',
        definition: 'volverse uno con algo',
        targetExample: 'El sonido se fundía con el silencio.',
        nativeExample: 'The sound merged with the silence.',
        belowCefr: false,
        reasoning: undefined,
      },
    ])
  })

  it('parses a highlight-source chunk and preserves highlight_id + reasoning', () => {
    const raw = [
      {
        source: 'highlight',
        highlight_id: 'aaaa1111-bbbb-2222-cccc-333344445555',
        headword: 'estar a punto de',
        sense: 'about to',
        surface_form: 'estaba a punto de',
        segment_id: 'seg-2',
        translation: 'about to',
        definition: 'verge of doing something',
        target_example: 'Estaba a punto de irse.',
        native_example: 'He was about to leave.',
        below_cefr: false,
        reasoning: 'user-flagged idiom',
      },
    ]
    expect(parseBasicDataChunks(raw)[0]).toMatchObject({
      source: 'highlight',
      highlightId: 'aaaa1111-bbbb-2222-cccc-333344445555',
      headword: 'estar a punto de',
      reasoning: 'user-flagged idiom',
    })
  })

  it('coerces nulls and missing fields defensively (translation/example may be null)', () => {
    const raw = [
      {
        source: 'llm',
        headword: 'foo',
        // no sense field at all
        surface_form: 'foo',
        segment_id: 'x',
        translation: null,
        definition: null,
        target_example: null,
        native_example: null,
        below_cefr: true,
      },
    ]
    const [parsed] = parseBasicDataChunks(raw)
    expect(parsed.sense).toBe('')
    expect(parsed.translation).toBeNull()
    expect(parsed.definition).toBeNull()
    expect(parsed.targetExample).toBeNull()
    expect(parsed.nativeExample).toBeNull()
    expect(parsed.belowCefr).toBe(true)
  })

  it("normalizes invalid `source` values to 'llm'", () => {
    const raw = [{ source: 'something-weird', headword: 'x', surface_form: 'x', segment_id: 's', below_cefr: false }]
    expect(parseBasicDataChunks(raw)[0].source).toBe('llm')
  })
})
