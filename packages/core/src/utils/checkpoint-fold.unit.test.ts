import { describe, expect, test } from 'vitest'
import { foldCheckpointToken, foldUserHeadwordCandidates } from './checkpoint-fold'

describe('foldCheckpointToken', () => {
  test('strips Russian stress marks, lowercases, and folds ё→е', () => {
    expect(foldCheckpointToken('Стола́', 'ru')).toBe('стола')
    expect(foldCheckpointToken('ЁЖ', 'ru')).toBe('еж')
    expect(foldCheckpointToken('всё', 'ru')).toBe('все')
  })

  test('folds German ß→ss (including capital ẞ via lowercasing)', () => {
    expect(foldCheckpointToken('Straße', 'de')).toBe('strasse')
    expect(foldCheckpointToken('STRAẞE', 'de')).toBe('strasse')
  })

  test('composes decomposed input to NFC before comparing', () => {
    // a + combining diaeresis (U+0308) must fold identically to precomposed ä.
    expect(foldCheckpointToken('Bär', 'de')).toBe('bär')
    expect(foldCheckpointToken('Bär', 'de')).toBe('bär')
  })

  test('trims whitespace and applies no per-language fold outside ru/de', () => {
    expect(foldCheckpointToken('  Straße  ', 'en')).toBe('straße')
    expect(foldCheckpointToken(' Running ', 'en')).toBe('running')
  })
})

describe('foldUserHeadwordCandidates', () => {
  test('strips the English infinitive particle as an extra candidate', () => {
    expect(foldUserHeadwordCandidates('To Run', 'en')).toEqual(['to run', 'run'])
  })

  test('strips the German reflexive particle as an extra candidate', () => {
    expect(foldUserHeadwordCandidates('sich freuen', 'de')).toEqual(['sich freuen', 'freuen'])
  })

  test('returns only the folded headword for Russian', () => {
    expect(foldUserHeadwordCandidates('Обнару́жить', 'ru')).toEqual(['обнаружить'])
  })

  test('does not strip particles that are the whole headword', () => {
    expect(foldUserHeadwordCandidates('to ', 'en')).toEqual(['to'])
  })
})
