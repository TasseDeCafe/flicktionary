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

  test('orthographic acutes survive decomposed input (NFC runs before the strip)', () => {
    // NFD input (base letter + combining acute U+0301, written as escapes so
    // no editor can silently re-normalize it) must fold identically to its
    // precomposed NFC spelling — never lose the accent and collide with a
    // different word (más vs mas).
    expect(foldCheckpointToken('ma\u0301s', 'es')).toBe('m\u00e1s')
    expect(foldCheckpointToken('avo\u0301', 'pt')).toBe('av\u00f3')
    expect(foldCheckpointToken('e\u0301te\u0301', 'fr')).toBe('\u00e9t\u00e9')
    expect(foldCheckpointToken('cafe\u0301', 'en')).toBe('caf\u00e9')
    // Vietnamese stacks two marks: e + circumflex + acute composes to ế; the
    // old strip-first order corrupted it to ê (a different tone).
    expect(foldCheckpointToken('e\u0302\u0301', 'vi')).toBe('\u1ebf')
  })

  test('still strips decomposed Russian stress marks after NFC (they never compose)', () => {
    expect(foldCheckpointToken('стола\u0301', 'ru')).toBe('стола')
  })

  test('trims whitespace and applies no per-language fold outside ru/de/fr', () => {
    expect(foldCheckpointToken('  Straße  ', 'en')).toBe('straße')
    expect(foldCheckpointToken(' Running ', 'en')).toBe('running')
  })

  test('strips one leading French elision clitic (both apostrophe shapes)', () => {
    expect(foldCheckpointToken("l'homme", 'fr')).toBe('homme')
    expect(foldCheckpointToken('L’Homme', 'fr')).toBe('homme')
    expect(foldCheckpointToken("j'arrive", 'fr')).toBe('arrive')
    expect(foldCheckpointToken('c’est', 'fr')).toBe('est')
    expect(foldCheckpointToken("qu'il", 'fr')).toBe('il')
    expect(foldCheckpointToken("jusqu'à", 'fr')).toBe('à')
    expect(foldCheckpointToken("s'appeler", 'fr')).toBe('appeler')
  })

  test('keeps interior French apostrophes and strips at most one clitic', () => {
    expect(foldCheckpointToken("aujourd'hui", 'fr')).toBe("aujourd'hui")
    expect(foldCheckpointToken('aujourd’hui', 'fr')).toBe("aujourd'hui")
    expect(foldCheckpointToken("quelqu'un", 'fr')).toBe("quelqu'un")
    // quoiqu' is a clitic; the bare qu alternative must not fire mid-word.
    expect(foldCheckpointToken("quoiqu'il", 'fr')).toBe('il')
  })

  test('folds French ligatures to their digraph spellings', () => {
    expect(foldCheckpointToken('cœur', 'fr')).toBe('coeur')
    expect(foldCheckpointToken('ŒUVRE', 'fr')).toBe('oeuvre')
    expect(foldCheckpointToken('ex æquo', 'fr')).toBe('ex aequo')
    // No French fold outside fr — the same word keeps its ligature in en.
    expect(foldCheckpointToken('cœur', 'en')).toBe('cœur')
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

  test('strips the French pronominal particle as an extra candidate (elided via the fold)', () => {
    expect(foldUserHeadwordCandidates('se laver', 'fr')).toEqual(['se laver', 'laver'])
    // s'appeler needs no headword rule — the fold's clitic strip reduces it.
    expect(foldUserHeadwordCandidates("s'appeler", 'fr')).toEqual(['appeler'])
  })

  test('adds the de-reflexivized base for Spanish fused and Portuguese hyphenated citations', () => {
    expect(foldUserHeadwordCandidates('ducharse', 'es')).toEqual(['ducharse', 'duchar'])
    expect(foldUserHeadwordCandidates('acordarse', 'es')).toEqual(['acordarse', 'acordar'])
    expect(foldUserHeadwordCandidates('queixar-se', 'pt')).toEqual(['queixar-se', 'queixar'])
  })

  test('does not strip ordinary -se endings that are not reflexive citations', () => {
    // `clase` ends in -se but is a noun; only -arse/-erse/-irse strip in es.
    expect(foldUserHeadwordCandidates('clase', 'es')).toEqual(['clase'])
    expect(foldUserHeadwordCandidates('mise', 'pt')).toEqual(['mise'])
    expect(foldUserHeadwordCandidates('-se', 'pt')).toEqual(['-se'])
  })

  test('does not strip particles that are the whole headword', () => {
    expect(foldUserHeadwordCandidates('to ', 'en')).toEqual(['to'])
  })
})
