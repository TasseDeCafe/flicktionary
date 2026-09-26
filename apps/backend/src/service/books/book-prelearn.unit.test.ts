import { describe, expect, it } from 'vitest'
import { capitalizationAt, finishOccurrenceScan, newOccurrenceScanState, scanFirstOccurrences } from './book-prelearn'

const segments = (...texts: string[]) => texts.map((text, i) => ({ id: `seg-${i}`, text }))

const scan = (texts: string[], lemmasByToken: Map<string, Set<string>>, wanted: string[], targetLanguage = 'ru') => {
  const state = newOccurrenceScanState()
  scanFirstOccurrences(segments(...texts), lemmasByToken, new Set(wanted), targetLanguage, state)
  return finishOccurrenceScan(state)
}

describe('scanFirstOccurrences', () => {
  it('takes the first guarded occurrence of each lemma, in reading order', () => {
    const found = scan(
      ['Он пришёл при свете.', 'Они пёрли мешки, а потом снова пёрли.'],
      new Map([
        ['перли', new Set(['переть'])],
        // «при» survived the guard only as «при»: it never stands in for «переть».
        ['при', new Set(['при'])],
      ]),
      ['переть', 'при']
    )
    expect(found.get('при')).toEqual({ segmentId: 'seg-0', surface: 'при', context: 'Он пришёл при свете.' })
    expect(found.get('переть')).toMatchObject({ segmentId: 'seg-1', surface: 'пёрли' })
  })

  it('skips digit-hyphen compound pieces', () => {
    const found = scan(['Ему был 27-летний друг.', 'Летний день.'], new Map([['летний', new Set(['летний'])]]), [
      'летний',
    ])
    expect(found.get('летний')).toMatchObject({ segmentId: 'seg-1', surface: 'Летний' })
  })

  it('drops a name-like word even when a sighting opened a sentence; sentence starts are only a fallback', () => {
    const found = scan(
      [
        '— Волан-де-Морт вернулся, — сказал он.',
        'Тут вошёл Перси и сказал про Волан-де-Морта.',
        'Рон и Перси спорили о Волан-де-Морте, а Перси молчал о Волан-де-Морте.',
        'Однако все молчали.',
        'Она говорила быстро.',
      ],
      new Map([
        ['перси', new Set(['перси'])],
        ['волан', new Set(['волан'])],
        ['однако', new Set(['однако'])],
        ['она', new Set(['она'])],
      ]),
      ['перси', 'волан', 'однако', 'она']
    )
    expect(found.has('перси')).toBe(false)
    expect(found.has('волан')).toBe(false)
    // Only ever seen at a sentence start: the fallback sighting stands.
    expect(found.get('однако')).toMatchObject({ segmentId: 'seg-3', surface: 'Однако' })
    expect(found.get('она')).toMatchObject({ segmentId: 'seg-4' })
  })

  it('prefers a later lowercase sighting over a sentence-initial one', () => {
    const found = scan(
      ['Летом было жарко.', 'Всё лето шёл дождь.'],
      new Map([
        ['летом', new Set(['лето'])],
        ['лето', new Set(['лето'])],
      ]),
      ['лето']
    )
    expect(found.get('лето')).toMatchObject({ segmentId: 'seg-1', surface: 'лето' })
  })

  it('keeps German nouns, which are capitalized everywhere', () => {
    const found = scan(['Er sah das Haus.'], new Map([['haus', new Set(['haus'])]]), ['haus'], 'de')
    expect(found.get('haus')).toMatchObject({ surface: 'Haus' })
  })

  it('leaves a lemma out when it never occurs', () => {
    expect(scan(['Пусто.'], new Map(), ['слово']).size).toBe(0)
  })
})

describe('capitalizationAt', () => {
  it('tells mid-sentence capitals from sentence starts', () => {
    expect(capitalizationAt('Он видел Перси.', 9)).toBe('mid_sentence')
    expect(capitalizationAt('Перси ушёл.', 0)).toBe('sentence_start')
    expect(capitalizationAt('Он ушёл. Перси остался.', 9)).toBe('sentence_start')
    expect(capitalizationAt('Он сказал: «Перси!»', 12)).toBe('sentence_start')
    expect(capitalizationAt('— Перси, стой!', 2)).toBe('sentence_start')
    expect(capitalizationAt('Он видел перси.', 9)).toBe('lower')
  })
})
