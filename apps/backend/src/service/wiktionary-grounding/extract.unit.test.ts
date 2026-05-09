import { describe, expect, it } from 'vitest'
import { extractGrammarPatch, extractDisplayForm, type KaikkiEntry } from './extract'

// Minimal fixtures shaped after real kaikki Russian entries. Only the fields
// the extractor reads are populated.
const verbObnaruzhit: KaikkiEntry = {
  word: 'обнаружить',
  pos: 'verb',
  head_templates: [
    {
      name: 'ru-verb',
      args: { '1': 'обнару́жить', '2': 'pf', impf: 'обнаруживать' },
      expansion: 'обнару́жить • (obnarúžitʹ) (perfective, transitive, ...)',
    },
  ],
  senses: [{}],
}

const verbReflexive: KaikkiEntry = {
  word: 'находиться',
  pos: 'verb',
  head_templates: [
    {
      name: 'ru-verb',
      args: { '1': 'находи́ться', '2': 'impf', pf: 'найтись' },
      expansion: 'находи́ться • (naxodítʹsja) (imperfective, ...)',
    },
  ],
  senses: [{}],
}

const verbWithMultiplePairs: KaikkiEntry = {
  word: 'класть',
  pos: 'verb',
  head_templates: [
    {
      name: 'ru-verb',
      args: { '1': 'класть', '2': 'impf', pf: 'положи́ть,сложи́ть' },
      expansion: 'класть • (klastʹ) (imperfective)',
    },
  ],
  senses: [{}],
}

const nounKniga: KaikkiEntry = {
  word: 'книга',
  pos: 'noun',
  head_templates: [
    {
      name: 'ru-noun+',
      args: { '1': 'кни́га' },
      expansion: 'кни́га • (kníga) f inan (genitive кни́ги, ...)',
    },
  ],
  senses: [{}],
}

const nounNozhnitsy: KaikkiEntry = {
  word: 'ножницы',
  pos: 'noun',
  head_templates: [
    {
      name: 'ru-noun+',
      args: {},
      expansion: 'но́жницы • (nóžnicy) f inan pl (genitive ножниц, ...)',
    },
  ],
  senses: [{}],
}

const nounKofe: KaikkiEntry = {
  word: 'кофе',
  pos: 'noun',
  head_templates: [
    {
      name: 'ru-noun+',
      args: {},
      expansion: 'ко́фе • (kófe) m inan or n inan (indeclinable)',
    },
  ],
  senses: [{}],
}

const nounMat: KaikkiEntry = {
  word: 'мать',
  pos: 'noun',
  head_templates: [
    {
      name: 'ru-noun+',
      args: {},
      expansion: 'мать • (matʹ) f anim (genitive ма́тери, ...)',
    },
  ],
  senses: [{}],
}

describe('extractDisplayForm', () => {
  it('strips everything past the bullet', () => {
    expect(extractDisplayForm(verbObnaruzhit)).toBe('обнару́жить')
    expect(extractDisplayForm(nounKniga)).toBe('кни́га')
  })

  it('returns null when head_templates is missing', () => {
    expect(extractDisplayForm({ word: 'foo', pos: 'noun' })).toBeNull()
  })

  it('returns null when expansion has no bullet at all', () => {
    expect(extractDisplayForm({ head_templates: [{ name: 'x', expansion: 'no-bullet-here' }] } as KaikkiEntry)).toBe(
      'no-bullet-here'
    )
  })
})

describe('extractGrammarPatch — verbs', () => {
  it('extracts aspect, aspect_pair_headword (stress-stripped), is_reflexive=false', () => {
    expect(extractGrammarPatch(verbObnaruzhit)).toEqual({
      pos: 'verb',
      aspect: 'perf',
      aspect_pair_headword: 'обнаруживать',
      is_reflexive: false,
      display_form: 'обнару́жить',
    })
  })

  it('flags is_reflexive=true on -ся lemmas', () => {
    expect(extractGrammarPatch(verbReflexive)).toMatchObject({
      pos: 'verb',
      aspect: 'impf',
      aspect_pair_headword: 'найтись',
      is_reflexive: true,
    })
  })

  it('keeps only the first aspect pair when kaikki returns several', () => {
    expect(extractGrammarPatch(verbWithMultiplePairs)).toMatchObject({
      pos: 'verb',
      aspect: 'impf',
      aspect_pair_headword: 'положить',
    })
  })
})

describe('extractGrammarPatch — nouns', () => {
  it('extracts gender + animacy from afterRoman tokens', () => {
    expect(extractGrammarPatch(nounKniga)).toEqual({
      pos: 'noun',
      gender: 'f',
      animacy: 'inanimate',
      display_form: 'кни́га',
    })
  })

  it('detects plurale_tantum via the "pl" token', () => {
    expect(extractGrammarPatch(nounNozhnitsy)).toMatchObject({
      pos: 'noun',
      number_only: 'plurale_tantum',
    })
  })

  it('detects indeclinable from the full expansion (not just afterRoman)', () => {
    expect(extractGrammarPatch(nounKofe)).toMatchObject({
      pos: 'noun',
      gender: 'm',
      animacy: 'inanimate',
      is_indeclinable: true,
    })
  })

  it('extracts animate marker', () => {
    expect(extractGrammarPatch(nounMat)).toMatchObject({
      pos: 'noun',
      gender: 'f',
      animacy: 'animate',
    })
  })
})
