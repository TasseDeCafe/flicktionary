import { describe, expect, test } from 'vitest'
import type { GlossWordFamily } from '@flicktionary/core/types/gloss-view-state'
import { frontClueFor, productionClueFor, type ProductionClue } from './card-word-family'

const family = (overrides: Partial<GlossWordFamily>): GlossWordFamily => ({
  formOf: null,
  parts: null,
  anchors: [],
  cognates: [],
  insightPending: false,
  ...overrides,
})

describe('frontClueFor', () => {
  test('no family or nothing informative gives no clue', () => {
    expect(frontClueFor(null)).toBeNull()
    expect(frontClueFor(undefined)).toBeNull()
    expect(frontClueFor(family({}))).toBeNull()
    expect(
      frontClueFor(
        family({
          parts: [
            { text: 'за-', isAffix: true, meaning: null },
            { text: 'мёрзнуть', isAffix: false, meaning: null },
          ],
        })
      )
    ).toBeNull()
  })

  test('cognates alone are not a front clue', () => {
    expect(frontClueFor(family({ cognates: ['dozen'] }))).toBeNull()
  })

  test('an anchor, a form-of note or an explained part qualifies, without cognates', () => {
    const anchored = frontClueFor(family({ anchors: [{ lemma: 'мороз', source: 'known' }], cognates: ['frost'] }))
    expect(anchored?.anchors).toEqual([{ lemma: 'мороз', source: 'known' }])
    expect(anchored?.cognates).toEqual([])

    expect(frontClueFor(family({ formOf: { kind: 'participle', lemma: 'замёрзнуть' } }))).not.toBeNull()

    const explained = frontClueFor(
      family({
        parts: [
          { text: 'за-', isAffix: true, meaning: 'into a state' },
          { text: 'мёрзнуть', isAffix: false, meaning: null },
        ],
      })
    )
    expect(explained?.parts?.[0].meaning).toBe('into a state')
  })
})

describe('productionClueFor', () => {
  const part = (text: string, meaning: string | null, isAffix = text.startsWith('-') || text.endsWith('-')) => ({
    text,
    isAffix,
    meaning,
  })

  // Every string a production clue carries, so a test can assert none of
  // them spells a family member.
  const clueStrings = (clue: ProductionClue | null) => (clue ? clue.parts.map((p) => p.meaning) : [])

  test('a known base word is marked without spelling it (писатель)', () => {
    const wordFamily = family({
      parts: [part('писать', 'to write'), part('-тель', 'one who does the action')],
      anchors: [{ lemma: 'писа́ть', source: 'known' }],
    })
    const clue = productionClueFor(wordFamily, 'ru')
    expect(clue).toEqual({
      formOfKind: null,
      parts: [
        { role: 'root', meaning: 'to write', anchor: 'known' },
        { role: 'suffix', meaning: 'one who does the action', anchor: null },
      ],
    })
    expect(clueStrings(clue).join(' ')).not.toMatch(/\p{Script=Cyrillic}/u)
  })

  test('an anchor that is not a part is not mentioned (безопасность ← опасность)', () => {
    const clue = productionClueFor(
      family({
        parts: [part('безопасный', 'safe'), part('-ость', 'the quality of being …')],
        anchors: [{ lemma: 'опасность', source: 'known' }],
      }),
      'ru'
    )
    expect(clue?.parts.map((p) => p.anchor)).toEqual([null, null])
  })

  test('ё/е spellings of an anchor still match its part (saved)', () => {
    const clue = productionClueFor(
      family({
        parts: [part('за-', 'into a state'), part('мёрзнуть', 'to freeze')],
        anchors: [{ lemma: 'мерзнуть', source: 'saved' }],
      }),
      'ru'
    )
    expect(clue?.parts[1].anchor).toBe('saved')
  })

  test('a participle keeps its kind but never its lemma (замерзший)', () => {
    const clue = productionClueFor(
      family({
        formOf: { kind: 'participle', lemma: 'замёрзнуть' },
        parts: [
          part('за-', 'into a state, completely'),
          part('мёрзнуть', 'to freeze, be cold'),
          part('-ший', 'past active participle'),
        ],
      }),
      'ru'
    )
    expect(clue?.formOfKind).toBe('participle')
    expect(clue?.parts.map((p) => p.role)).toEqual(['prefix', 'root', 'suffix'])
    expect(JSON.stringify(clue)).not.toContain('мёрзнуть')
  })

  test('an affix-only breakdown promotes its stem to root (понимать)', () => {
    const clue = productionClueFor(
      family({ parts: [part('по-', 'getting hold of'), part('-нимать', 'take, grasp')] }),
      'ru'
    )
    expect(clue?.parts.map((p) => p.role)).toEqual(['prefix', 'root'])
  })

  test('a linking vowel is dropped (водопад)', () => {
    const clue = productionClueFor(
      family({ parts: [part('вода', 'water'), part('-о-', 'linking vowel'), part('падать', 'to fall')] }),
      'ru'
    )
    expect(clue?.parts.map((p) => p.meaning)).toEqual(['water', 'to fall'])
  })

  test('unexplained parts are dropped; nothing explained gives no clue', () => {
    expect(
      productionClueFor(family({ parts: [part('при-', null), part('город', 'city, town')] }), 'ru')?.parts
    ).toEqual([{ role: 'root', meaning: 'city, town', anchor: null }])
    expect(productionClueFor(family({ parts: [part('за-', null), part('мёрзнуть', null)] }), 'ru')).toBeNull()
  })

  test('opaque words, or no line at all, give no clue', () => {
    expect(productionClueFor(null, 'ru')).toBeNull()
    expect(productionClueFor(family({ parts: null, anchors: [{ lemma: 'собака', source: 'known' }] }), 'ru')).toBeNull()
  })

  test('cognates mean a loanword: no clue (серьезный, дюжина)', () => {
    const серьезный = [part('серьёз-', 'from french sérieux'), part('-ный', 'adjective suffix')]
    expect(productionClueFor(family({ parts: серьезный, cognates: ['serious'] }), 'ru')).toBeNull()
    expect(productionClueFor(family({ parts: null, cognates: ['dozen'] }), 'ru')).toBeNull()
  })

  test('a donor-language note gives no clue even without cognates', () => {
    const серьезный = [part('серьёз-', 'from french sérieux'), part('-ный', 'adjective suffix')]
    expect(productionClueFor(family({ parts: серьезный }), 'ru')).toBeNull()
    // "from the start" is not an etymology note (изначально).
    expect(
      productionClueFor(
        family({ parts: [part('изначальный', 'original, from the start'), part('-о', 'forms adverb')] }),
        'ru'
      )
    ).not.toBeNull()
  })

  test('a meaning in the target script gives no clue', () => {
    expect(
      productionClueFor(family({ parts: [part('писать', 'выводить буквы'), part('-тель', 'тот, кто делает')] }), 'ru')
    ).toBeNull()
  })
})
