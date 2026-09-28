import { describe, expect, test } from 'vitest'
import { cleanComponent, isInformativeStructure, parseWordFamily, sharesStem } from './parse-word-family'

describe('cleanComponent', () => {
  test('strips inline modifiers, nested ones included', () => {
    expect(cleanComponent('Haus<t:house>')).toBe('Haus')
    expect(cleanComponent('-ed<id:past participle>')).toBe('-ed')
    expect(cleanComponent('скрипе́ть<t:to creak>')).toBe('скрипеть')
  })

  test('drops foreign-language components', () => {
    expect(cleanComponent('la:cantāns')).toBeNull()
    expect(cleanComponent('sla-pro:*tovarъ')).toBeNull()
    expect(cleanComponent('it:arcipelago<ety:af<grc:ἀρχι-<ety:from<ἀρχι->>><grc:πέλαγος>>')).toBeNull()
  })

  test('keeps orthographic accents while stripping stress', () => {
    expect(cleanComponent('obstáculo')).toBe('obstáculo')
    expect(cleanComponent('мёрзнуть')).toBe('мёрзнуть')
  })
})

describe('parseWordFamily', () => {
  test('af template: prefix + base', () => {
    const parsed = parseWordFamily(
      {
        etymology_templates: [{ name: 'af', args: { '1': 'ru', '2': 'за-', '3': 'мёрзнуть' } }],
      },
      'ru'
    )
    expect(parsed.parts).toEqual([
      { text: 'за-', isAffix: true },
      { text: 'мёрзнуть', isAffix: false },
    ])
    expect(parsed.parents).toEqual(['мёрзнуть'])
    expect(parsed.formOf).toBeNull()
  })

  test('participle senses follow form-of; plain inflections do not', () => {
    const participle = parseWordFamily(
      {
        senses: [
          {
            tags: ['active', 'form-of', 'participle', 'past', 'perfective'],
            form_of: [{ word: 'замёрзнуть', extra: 'zamjórznutʹ' }],
          },
        ],
      },
      'ru'
    )
    expect(participle.formOf).toEqual({ kind: 'participle', lemma: 'замёрзнуть' })
    expect(participle.parents).toEqual(['замёрзнуть'])

    const adverbial = parseWordFamily(
      {
        senses: [{ tags: ['adverbial', 'form-of', 'participle'], form_of: [{ word: 'замёрзнуть' }] }],
      },
      'ru'
    )
    expect(adverbial.formOf?.kind).toBe('adverbial_participle')

    const inflection = parseWordFamily(
      {
        senses: [{ tags: ['form-of', 'genitive', 'singular'], form_of: [{ word: 'сталь' }] }],
      },
      'ru'
    )
    expect(inflection.formOf).toBeNull()
    expect(inflection.parents).toEqual([])
  })

  test('prefix / suffix / confix templates add the missing hyphens', () => {
    expect(
      parseWordFamily(
        {
          etymology_templates: [{ name: 'pre', args: { '1': 'ru', '2': 'авиа', '3': 'учи́лище' } }],
        },
        'ru'
      ).parts
    ).toEqual([
      { text: 'авиа-', isAffix: true },
      { text: 'училище', isAffix: false },
    ])
    expect(
      parseWordFamily(
        {
          etymology_templates: [{ name: 'suf', args: { '1': 'ru', '2': 'десятибо́рье', '3': 'ец' } }],
        },
        'ru'
      ).parts
    ).toEqual([
      { text: 'десятиборье', isAffix: false },
      { text: '-ец', isAffix: true },
    ])
    const confix = parseWordFamily(
      {
        etymology_templates: [{ name: 'confix', args: { '1': 'ru', '2': 'по', '3': 'голова́', '4': 'ье' } }],
      },
      'ru'
    )
    expect(confix.parts).toEqual([
      { text: 'по-', isAffix: true },
      { text: 'голова', isAffix: false },
      { text: '-ье', isAffix: true },
    ])
    expect(confix.parents).toEqual(['голова'])
  })

  test('deverbal: a single "derived from" part', () => {
    const parsed = parseWordFamily(
      {
        etymology_templates: [{ name: 'deverbal', args: { '1': 'ru', '2': 'входи́ть' } }],
      },
      'ru'
    )
    expect(parsed.parts).toEqual([{ text: 'входить', isAffix: false }])
    expect(parsed.parents).toEqual(['входить'])
  })

  test('unified ety template: structural segments only, foreign components skipped', () => {
    const parsed = parseWordFamily(
      {
        etymology_templates: [
          { name: 'ety', args: { '1': 'ru', '2': ':af', '3': 'скрипе́ть<t:to creak>', '4': '-ка', tree: '+' } },
        ],
      },
      'ru'
    )
    expect(parsed.parts).toEqual([
      { text: 'скрипеть', isAffix: false },
      { text: '-ка', isAffix: true },
    ])
    expect(parsed.parents).toEqual(['скрипеть'])

    const borrowed = parseWordFamily(
      {
        etymology_templates: [
          { name: 'ety', args: { '1': 'ru', '2': ':der', '3': 'sla-pro:*tъčьka', '4': ':afeq', '5': '-ка' } },
        ],
      },
      'ru'
    )
    expect(borrowed.parents).toEqual([])

    const foreignBase = parseWordFamily(
      {
        etymology_templates: [{ name: 'ety', args: { '1': 'ru', '2': ':af', '3': 'de:unikal', '4': '-ный' } }],
      },
      'ru'
    )
    expect(foreignBase.parts).toEqual([{ text: '-ный', isAffix: true }])
    expect(foreignBase.parents).toEqual([])
  })

  test('skips templates describing another language', () => {
    const parsed = parseWordFamily(
      {
        etymology_templates: [
          { name: 'af', args: { '1': 'sla-pro', '2': '*otъ-', '3': '*kryti' } },
          { name: 'surf', args: { '1': 'ru', '2': 'от-', '3': 'крыть' } },
        ],
      },
      'ru'
    )
    expect(parsed.parts).toEqual([
      { text: 'от-', isAffix: true },
      { text: 'крыть', isAffix: false },
    ])
    expect(parsed.parents).toEqual(['крыть'])
  })

  test('surface-analysis directives shift the args and name the derivation', () => {
    const parsed = parseWordFamily(
      { etymology_templates: [{ name: 'surf', args: { '1': '+bf', '2': 'ru', '3': 'гре́цкий' } }] },
      'ru'
    )
    expect(parsed.parts).toEqual([{ text: 'грецкий', isAffix: false }])
    expect(parsed.parents).toEqual(['грецкий'])
  })

  test('ignores clipping, blend and history templates', () => {
    const parsed = parseWordFamily(
      {
        etymology_templates: [
          { name: 'clipping', args: { '1': 'en', '2': 'stabilizer' } },
          { name: 'blend', args: { '1': 'en', '2': 'smoke', '3': 'fog' } },
          { name: 'inh', args: { '1': 'ru', '2': 'sla-pro', '3': '*rǫkavъ' } },
        ],
      },
      'ru'
    )
    expect(parsed.parts).toBeNull()
    expect(parsed.parents).toEqual([])
  })

  test('related/derived keep single words only', () => {
    const parsed = parseWordFamily(
      {
        related: [{ word: 'рука́' }],
        derived: [{ word: 'безрука́вка' }, { word: 'засучи́ть рукава́' }],
      },
      'ru'
    )
    expect(parsed.relatedWords).toEqual(['рука', 'безрукавка'])
  })
})

describe('isInformativeStructure', () => {
  const parts = (...texts: string[]) =>
    texts.map((text) => ({ text, isAffix: text.startsWith('-') || text.endsWith('-') }))

  test('a bare -ся breakdown says nothing on its own', () => {
    expect(isInformativeStructure({ formOf: null, parts: parts('смеяться', '-ся') }, 'ru')).toBe(false)
  })

  test('prefixes, compounds, derivations and form-of are informative', () => {
    expect(isInformativeStructure({ formOf: null, parts: parts('за-', 'мёрзнуть') }, 'ru')).toBe(true)
    expect(isInformativeStructure({ formOf: null, parts: parts('авто', 'трасса') }, 'ru')).toBe(true)
    expect(isInformativeStructure({ formOf: null, parts: parts('входить') }, 'ru')).toBe(true)
    expect(isInformativeStructure({ formOf: { kind: 'participle', lemma: 'замёрзнуть' }, parts: null }, 'ru')).toBe(
      true
    )
  })

  test('affix-only or empty structures are not', () => {
    expect(isInformativeStructure({ formOf: null, parts: parts('-ный') }, 'ru')).toBe(false)
    expect(isInformativeStructure({ formOf: null, parts: null }, 'ru')).toBe(false)
  })
})

describe('sharesStem', () => {
  const prefixes = ['на', 'за', 'по', 'у']

  test('keeps real family members', () => {
    expect(sharesStem('рукав', 'рука', prefixes)).toBe(true)
    expect(sharesStem('вязка', 'вязать', prefixes)).toBe(true)
    expect(sharesStem('насквозь', 'сквозь', prefixes)).toBe(true)
  })

  test('drops synonyms and hypernyms', () => {
    expect(sharesStem('хижина', 'ратуша', prefixes)).toBe(false)
    expect(sharesStem('халат', 'одежда', prefixes)).toBe(false)
    expect(sharesStem('ступня', 'нога', prefixes)).toBe(false)
  })
})
