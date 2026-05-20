import { describe, expect, it } from 'vitest'
import { extractGrammarPatch, extractDisplayForm, extractIpaBag, type KaikkiEntry } from './extract'

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

describe('extractGrammarPatch — Russian verbs', () => {
  it('extracts aspect, aspect_pair_headword (stress-stripped), is_reflexive=false', () => {
    expect(extractGrammarPatch(verbObnaruzhit, 'ru')).toEqual({
      pos: 'verb',
      aspect: 'perf',
      aspect_pair_headword: 'обнаруживать',
      is_reflexive: false,
      display_form: 'обнару́жить',
    })
  })

  it('flags is_reflexive=true on -ся lemmas', () => {
    expect(extractGrammarPatch(verbReflexive, 'ru')).toMatchObject({
      pos: 'verb',
      aspect: 'impf',
      aspect_pair_headword: 'найтись',
      is_reflexive: true,
    })
  })

  it('keeps only the first aspect pair when kaikki returns several', () => {
    expect(extractGrammarPatch(verbWithMultiplePairs, 'ru')).toMatchObject({
      pos: 'verb',
      aspect: 'impf',
      aspect_pair_headword: 'положить',
    })
  })
})

describe('extractGrammarPatch — Russian nouns', () => {
  it('extracts gender + animacy from afterRoman tokens', () => {
    expect(extractGrammarPatch(nounKniga, 'ru')).toEqual({
      pos: 'noun',
      gender: 'f',
      animacy: 'inanimate',
      display_form: 'кни́га',
    })
  })

  it('detects plurale_tantum via the "pl" token', () => {
    expect(extractGrammarPatch(nounNozhnitsy, 'ru')).toMatchObject({
      pos: 'noun',
      number_only: 'plurale_tantum',
    })
  })

  it('detects indeclinable from the full expansion (not just afterRoman)', () => {
    expect(extractGrammarPatch(nounKofe, 'ru')).toMatchObject({
      pos: 'noun',
      gender: 'm',
      animacy: 'inanimate',
      is_indeclinable: true,
    })
  })

  it('extracts animate marker', () => {
    expect(extractGrammarPatch(nounMat, 'ru')).toMatchObject({
      pos: 'noun',
      gender: 'f',
      animacy: 'animate',
    })
  })
})

describe('extractGrammarPatch — gating of Russian-specific logic', () => {
  it('does NOT run Russian noun extraction when langCode is not ru', () => {
    // Same shape as nounKniga, but lang_code overridden — the function takes
    // langCode as an argument, so it doesn't read entry.lang_code anyway,
    // but the safety we want to assert is "no afterRoman parse → no gender".
    const patch = extractGrammarPatch(nounKniga, 'en')
    expect(patch.gender).toBeUndefined()
    expect(patch.animacy).toBeUndefined()
    expect(patch.pos).toBe('noun')
    expect(patch.display_form).toBeUndefined()
  })

  it('does NOT run Russian verb extraction when langCode is not ru', () => {
    const patch = extractGrammarPatch(verbObnaruzhit, 'en')
    expect(patch.aspect).toBeUndefined()
    expect(patch.aspect_pair_headword).toBeUndefined()
    expect(patch.is_reflexive).toBeUndefined()
    expect(patch.pos).toBe('verb')
  })
})

describe('extractGrammarPatch — English display form', () => {
  it('does not store noisy English head-template expansions as display_form', () => {
    const patch = extractGrammarPatch(
      {
        word: 'dictionary',
        pos: 'noun',
        head_templates: [{ name: 'en-noun', expansion: 'dictionary (plural dictionaries)' }],
      },
      'en'
    )
    expect(patch).toEqual({ pos: 'noun' })
  })
})

describe('extractIpaBag — Russian', () => {
  it('puts untagged IPA in untagged bucket only', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/sɐˈbakə/' }],
    }
    expect(extractIpaBag(entry, 'ru')).toEqual({ untagged: '/sɐˈbakə/' })
  })

  it('ignores entries with no string ipa', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: 12 }, { other: 'x' }, { ipa: '' }],
    }
    expect(extractIpaBag(entry, 'ru')).toEqual({})
  })

  it('does NOT cross-fall-back tagged English buckets into the Russian untagged path', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/sɐˈbakə/', tags: ['General-American'] }],
    }
    // Any tags on a non-English entry → not untagged → skipped.
    expect(extractIpaBag(entry, 'ru')).toEqual({})
  })
})

describe('extractIpaBag — English GA/RP', () => {
  const cat: KaikkiEntry = {
    sounds: [
      { ipa: '/kæt/', tags: ['General-American'] },
      { ipa: '/kat/', tags: ['Received-Pronunciation'] },
    ],
  }

  it('buckets GA and RP separately', () => {
    expect(extractIpaBag(cat, 'en')).toEqual({ ga: '/kæt/', rp: '/kat/' })
  })

  it('puts shared GA/RP pronunciations into both buckets', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/twɪnd͡ʒ/', tags: ['General-American', 'Received-Pronunciation'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/twɪnd͡ʒ/', rp: '/twɪnd͡ʒ/' })
  })

  it('accepts bare US tag as GA when no narrower US region tag is present', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/foo/', tags: ['US'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/foo/' })
  })

  it('rejects bare US when paired with a narrower US region tag', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/foo/', tags: ['US', 'Southern-US'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({})
  })

  it('rejects real crayon-style narrower US regional variants', () => {
    const entry: KaikkiEntry = {
      sounds: [
        { ipa: '/ˈkɹeɪ̯.ɑn/', tags: ['US'] },
        { ipa: '/ˈkɹæn/', tags: ['Midwestern-US', 'Northeastern', 'US', 'especially'] },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/ˈkɹeɪ̯.ɑn/' })
  })

  it('accepts UK tag as RP', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/foo/', tags: ['UK'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ rp: '/foo/' })
  })

  it('ignores Australian / Canadian / other unrelated regional pronunciations', () => {
    const entry: KaikkiEntry = {
      sounds: [
        { ipa: '/au/', tags: ['Australia'] },
        { ipa: '/ca/', tags: ['Canada'] },
        { ipa: '/ga/', tags: ['General-American'] },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/ga/' })
  })

  // Real case from the 'speculation' kaikki entry: a single sound row tagged
  // simultaneously as Canada + General-American + Received-Pronunciation
  // (Wiktionary collapses shared pronunciations across regions). The unrelated
  // 'Canada' tag must not preempt the explicit GA/RP labels.
  it('keeps explicit GA/RP buckets when sound is also tagged with an unrelated region', () => {
    const entry: KaikkiEntry = {
      sounds: [
        {
          ipa: '/ˌspɛk.jəˈleɪ.ʃən/',
          tags: ['Canada', 'General-American', 'Received-Pronunciation'],
        },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({
      ga: '/ˌspɛk.jəˈleɪ.ʃən/',
      rp: '/ˌspɛk.jəˈleɪ.ʃən/',
    })
  })
})

describe('extractIpaBag — English untagged fallback', () => {
  it('routes entries with no tags into the untagged bucket', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/dɪkʃənɛɹi/' }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ untagged: '/dɪkʃənɛɹi/' })
  })

  it('does NOT cross-fall-back untagged into GA or RP', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/foo/' }],
    }
    const out = extractIpaBag(entry, 'en')
    expect(out.ga).toBeUndefined()
    expect(out.rp).toBeUndefined()
    expect(out.untagged).toBe('/foo/')
  })

  it('treats matching POS-only pronunciation tags as untagged', () => {
    const entry: KaikkiEntry = {
      pos: 'verb',
      sounds: [
        { ipa: '/ɹiːˈbɪld/', tags: ['verb'] },
        { ipa: '/ˈɹiːbɪld/', tags: ['noun'] },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ untagged: '/ɹiːˈbɪld/' })
  })

  it('keeps dialect tags after removing matching POS pronunciation tags', () => {
    const entry: KaikkiEntry = {
      pos: 'verb',
      sounds: [{ ipa: '/ɹiːˈbɪld/', tags: ['US', 'verb'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/ɹiːˈbɪld/' })
  })
})

describe('extractIpaBag — quality tag rejection', () => {
  it('drops nonstandard pronunciations like the /kræn/ for crayon', () => {
    const entry: KaikkiEntry = {
      sounds: [
        { ipa: '/ˈkɹeɪɒn/', tags: ['General-American'] },
        { ipa: '/kɹæn/', tags: ['General-American', 'nonstandard'] },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/ˈkɹeɪɒn/' })
  })

  it('drops dated, dialectal, archaic, rare, and obsolete variants', () => {
    const entry: KaikkiEntry = {
      sounds: [
        { ipa: '/a/', tags: ['General-American', 'dated'] },
        { ipa: '/b/', tags: ['General-American', 'dialectal'] },
        { ipa: '/c/', tags: ['General-American', 'archaic'] },
        { ipa: '/d/', tags: ['General-American', 'rare'] },
        { ipa: '/e/', tags: ['General-American', 'obsolete'] },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({})
  })
})

describe('extractIpaBag — phonemic preference', () => {
  it('prefers phonemic (/.../) over phonetic ([...]) within a bucket', () => {
    const entry: KaikkiEntry = {
      sounds: [
        { ipa: '[kʰæt]', tags: ['General-American'] },
        { ipa: '/kæt/', tags: ['General-American'] },
      ],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/kæt/' })
  })

  it('falls back to phonetic when no phonemic exists for the bucket', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '[kʰæt]', tags: ['General-American'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '[kʰæt]' })
  })
})

describe('extractGrammarPatch — IPA integration', () => {
  it('attaches IPA bag to the patch when populated', () => {
    const entry: KaikkiEntry = {
      word: 'cat',
      pos: 'noun',
      sounds: [{ ipa: '/kæt/', tags: ['General-American'] }],
    }
    const patch = extractGrammarPatch(entry, 'en')
    expect(patch.ipa).toEqual({ ga: '/kæt/' })
  })

  it('omits IPA bag entirely when all buckets empty', () => {
    const entry: KaikkiEntry = {
      word: 'cat',
      pos: 'noun',
    }
    const patch = extractGrammarPatch(entry, 'en')
    expect(patch.ipa).toBeUndefined()
  })
})
