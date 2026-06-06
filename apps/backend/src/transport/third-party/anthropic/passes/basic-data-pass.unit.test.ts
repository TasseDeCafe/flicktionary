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
        surface_translation: 'merged with',
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
        surfaceTranslation: 'merged with',
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
    expect(parsed.surfaceTranslation).toBeNull()
    expect(parsed.definition).toBeNull()
    expect(parsed.targetExample).toBeNull()
    expect(parsed.nativeExample).toBeNull()
    expect(parsed.belowCefr).toBe(true)
  })

  it("normalizes invalid `source` values to 'llm'", () => {
    const raw = [{ source: 'something-weird', headword: 'x', surface_form: 'x', segment_id: 's', below_cefr: false }]
    expect(parseBasicDataChunks(raw)[0].source).toBe('llm')
  })

  it('round-trips a Russian grammar bag (gender, aspect, aspect_pair_headword, government, plurale_tantum, notable_forms)', () => {
    const raw = [
      // Soft-sign masculine noun.
      {
        source: 'llm',
        headword: 'день',
        sense: 'day',
        surface_form: 'день',
        segment_id: 's-1',
        translation: 'day',
        definition: 'светлая часть суток',
        target_example: 'День был длинным.',
        native_example: 'The day was long.',
        below_cefr: false,
        grammar: {
          pos: 'noun',
          gender: 'm',
          display_form: 'день',
        },
      },
      // Imperfective verb with a paired perfective and case government.
      {
        source: 'llm',
        headword: 'зависеть',
        sense: 'to depend on',
        surface_form: 'зависит',
        segment_id: 's-2',
        translation: 'to depend on',
        definition: 'обусловливаться чем-либо',
        target_example: 'Это зависит от тебя.',
        native_example: 'It depends on you.',
        below_cefr: false,
        grammar: {
          pos: 'verb',
          aspect: 'impf',
          government: 'от + gen',
          display_form: 'зави́сеть',
        },
      },
      // Plurale tantum noun with notable_forms.
      {
        source: 'llm',
        headword: 'деньги',
        sense: 'money',
        surface_form: 'деньги',
        segment_id: 's-3',
        translation: 'money',
        definition: 'средство обмена',
        target_example: 'У меня нет денег.',
        native_example: "I don't have any money.",
        below_cefr: false,
        grammar: {
          pos: 'noun',
          number_only: 'plurale_tantum',
          notable_forms: [{ label: 'gen.pl', form: 'денег' }],
          display_form: 'де́ньги',
        },
      },
    ]
    const parsed = parseBasicDataChunks(raw)
    expect(parsed[0].grammar).toEqual({ pos: 'noun', gender: 'm', display_form: 'день' })
    expect(parsed[1].grammar).toEqual({
      pos: 'verb',
      aspect: 'impf',
      government: 'от + gen',
      display_form: 'зави́сеть',
    })
    expect(parsed[2].grammar).toEqual({
      pos: 'noun',
      number_only: 'plurale_tantum',
      notable_forms: [{ label: 'gen.pl', form: 'денег' }],
      display_form: 'де́ньги',
    })
  })

  it('preserves unknown grammar keys (forward-compat for new languages)', () => {
    const raw = [
      {
        source: 'llm',
        headword: 'foo',
        sense: '',
        surface_form: 'foo',
        segment_id: 's',
        translation: null,
        definition: null,
        target_example: null,
        native_example: null,
        below_cefr: false,
        grammar: { pos: 'noun', tone: 'high', some_future_key: { nested: true } },
      },
    ]
    expect(parseBasicDataChunks(raw)[0].grammar).toEqual({
      pos: 'noun',
      tone: 'high',
      some_future_key: { nested: true },
    })
  })

  it('treats a missing or non-object grammar field as undefined', () => {
    const raw = [
      // No grammar key at all.
      {
        source: 'llm',
        headword: 'a',
        surface_form: 'a',
        segment_id: 's',
        translation: null,
        definition: null,
        target_example: null,
        native_example: null,
        below_cefr: false,
      },
      // grammar present but wrong type (array).
      {
        source: 'llm',
        headword: 'b',
        surface_form: 'b',
        segment_id: 's',
        translation: null,
        definition: null,
        target_example: null,
        native_example: null,
        below_cefr: false,
        grammar: [],
      },
    ]
    const parsed = parseBasicDataChunks(raw)
    expect(parsed[0].grammar).toBeUndefined()
    expect(parsed[1].grammar).toBeUndefined()
  })
})
