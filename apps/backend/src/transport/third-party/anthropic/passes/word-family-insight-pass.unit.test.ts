import { describe, expect, test } from 'vitest'
import { buildWordFamilyInsightPrompt, parseWordFamilyInsightInput } from './word-family-insight-pass'

const base = { ancestors: ['иметь'], fixedParts: null, explanationLanguage: 'en', targetLanguage: 'ru' }

describe('parseWordFamilyInsightInput', () => {
  test('keeps the breakdown with meanings, strips stress, filters verdicts to listed ancestors', () => {
    const result = parseWordFamilyInsightInput(
      {
        parts: [
          { text: 'за-', is_affix: true, meaning: 'into a state' },
          { text: 'мёрзнуть', is_affix: false, meaning: 'freeze' },
        ],
        missing_parents: ['моро́з', 'two words'],
        hidden_ancestors: ['иметь', 'unlisted'],
        cognates: ['dozen'],
      },
      base
    )
    expect(result).toEqual({
      parts: [
        { text: 'за-', isAffix: true },
        { text: 'мёрзнуть', isAffix: false },
      ],
      partMeanings: ['into a state', 'freeze'],
      missingParents: ['мороз'],
      hiddenAncestors: ['иметь'],
      cognates: ['dozen'],
    })
  })

  test('a lone affix is no breakdown; hyphenated text counts as an affix', () => {
    const result = parseWordFamilyInsightInput({ parts: [{ text: '-ся', is_affix: false, meaning: 'x' }] }, base)
    expect(result.parts).toEqual([])
    expect(result.partMeanings).toEqual([])
  })

  test('fixed parts keep their order; meanings pair by position, then by text', () => {
    const fixedParts = [
      { text: 'о-', isAffix: true },
      { text: 'жечь', isAffix: false },
    ]
    const result = parseWordFamilyInsightInput(
      {
        parts: [
          { text: 'жечь', is_affix: false, meaning: 'burn' },
          { text: 'other', is_affix: false, meaning: 'nope' },
        ],
        missing_parents: ['жечь'],
        hidden_ancestors: ['иметь'],
        cognates: [],
      },
      { ...base, fixedParts }
    )
    expect(result.parts).toBe(fixedParts)
    expect(result.partMeanings).toEqual([null, 'burn'])
    expect(result.missingParents).toEqual([])
    expect(result.hiddenAncestors).toEqual([])
  })

  test('no cognates when explaining in the target language', () => {
    const result = parseWordFamilyInsightInput(
      { parts: [], cognates: ['дюжина'] },
      { ...base, explanationLanguage: 'ru' }
    )
    expect(result.cognates).toEqual([])
  })
})

describe('buildWordFamilyInsightPrompt', () => {
  test('lists the kaikki breakdown and ancestors, or pins fixed parts', () => {
    const input = {
      targetLanguage: 'ru',
      explanationLanguage: 'en',
      headword: 'замёрзший',
      pos: 'verb',
      formOf: 'participle of замёрзнуть',
      kaikkiParts: [
        { text: 'за-', isAffix: true },
        { text: 'мёрзнуть', isAffix: false },
      ],
      ancestors: ['замёрзнуть', 'мёрзнуть'],
      fixedParts: null,
    }
    const fresh = buildWordFamilyInsightPrompt(input).userMessage
    expect(fresh).toContain('It is a participle of замёрзнуть.')
    expect(fresh).toContain('Dictionary breakdown: за- + мёрзнуть')
    expect(fresh).toContain('Ancestors in the dictionary data: замёрзнуть, мёрзнуть')

    const fixed = buildWordFamilyInsightPrompt({ ...input, fixedParts: input.kaikkiParts }).userMessage
    expect(fixed).toContain('Use exactly these parts, in this order')
    expect(fixed).not.toContain('Ancestors in the dictionary data')
  })
})
