import { describe, expect, it } from 'vitest'
import { buildBasicDataGrammarPatch } from './process-session'

describe('buildBasicDataGrammarPatch', () => {
  it('keeps the full LLM grammar patch before a lookup has been grounded', () => {
    const grammar = {
      pos: 'verb',
      aspect: 'perf',
      display_form: 'обнаружить',
      government: '+ acc',
    }

    expect(buildBasicDataGrammarPatch(grammar, false, false)).toEqual(grammar)
  })

  it('protects Wiktionary-owned keys after grounding while preserving LLM-only keys', () => {
    expect(
      buildBasicDataGrammarPatch(
        {
          pos: 'verb',
          aspect: 'impf',
          aspect_pair_headword: 'wrong',
          display_form: 'wrong',
          gender: 'f',
          animacy: 'animate',
          number_only: 'plurale_tantum',
          is_indeclinable: false,
          is_reflexive: true,
          government: '+ acc',
          notes: 'takes an animate object in this usage',
          notable_forms: [{ label: 'past', form: 'обнаружил' }],
        },
        true,
        false
      )
    ).toEqual({
      government: '+ acc',
      notes: 'takes an animate object in this usage',
      notable_forms: [{ label: 'past', form: 'обнаружил' }],
    })
  })

  it('returns null when an already-grounded patch only contains Wiktionary-owned keys', () => {
    expect(buildBasicDataGrammarPatch({ pos: 'noun', gender: 'm', display_form: 'стол' }, true, false)).toBeNull()
  })

  it('drops automatic grammar patches once the user has edited grammar provenance', () => {
    expect(buildBasicDataGrammarPatch({ government: '+ gen', notes: 'fresh LLM note' }, false, true)).toBeNull()
  })
})
