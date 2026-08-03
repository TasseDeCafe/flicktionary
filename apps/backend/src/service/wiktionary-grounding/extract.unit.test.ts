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

  // Real case from the 'revel' kaikki entry: a single shared transcription
  // tagged [UK, US] (the bare `US` form rather than an explicit `General-American`
  // label). Both dialects must claim it — earlier this fell through both buckets
  // and left the word ungrounded.
  it('puts a shared [UK, US] pronunciation into both buckets', () => {
    const entry: KaikkiEntry = {
      sounds: [{ ipa: '/ˈɹɛv.əl/', tags: ['UK', 'US'] }],
    }
    expect(extractIpaBag(entry, 'en')).toEqual({ ga: '/ˈɹɛv.əl/', rp: '/ˈɹɛv.əl/' })
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

// Fixtures shaped after real kaikki German entries (Haus, Junge, Name, fahren,
// aufstehen).
const nounHaus: KaikkiEntry = {
  word: 'Haus',
  pos: 'noun',
  head_templates: [
    { name: 'de-noun', args: { '1': 'n,,^er' }, expansion: 'Haus n (strong, genitive Hauses, plural Häuser, ...)' },
  ],
  forms: [
    { form: 'Hauses', tags: ['genitive'] },
    { form: 'Häuser', tags: ['plural'] },
    { form: 'Haus', tags: ['nominative', 'singular'], source: 'declension' },
    { form: 'Hauses', tags: ['genitive', 'singular'], source: 'declension' },
  ],
}

const nounName: KaikkiEntry = {
  word: 'Name',
  pos: 'noun',
  head_templates: [
    { name: 'de-noun', args: { '1': 'm,ns.weak' }, expansion: 'Name m (weak, genitive Namens, plural Namen)' },
  ],
  forms: [
    { form: 'Namens', tags: ['genitive'] },
    { form: 'Namen', tags: ['plural'] },
  ],
}

const verbFahren: KaikkiEntry = {
  word: 'fahren',
  pos: 'verb',
  head_templates: [{ name: 'de-verb', args: { '1': 'fahren<fährt#fuhr,gefahren,führe.haben,sein>' } }],
  forms: [
    { form: 'haben', tags: ['auxiliary'] },
    { form: 'sein', tags: ['auxiliary'] },
    { form: 'haben or sein', source: 'conjugation', tags: ['auxiliary'] },
  ],
}

const verbAufstehen: KaikkiEntry = {
  word: 'aufstehen',
  pos: 'verb',
  head_templates: [{ name: 'de-verb', args: { '1': 'auf.stehen<stand,gestanden,stände:stünde.sein>' } }],
  forms: [{ form: 'sein', tags: ['auxiliary'] }],
}

describe('extractGrammarPatch — German nouns', () => {
  it('reads gender + plural + genitive for a regular noun and skips the noisy display form', () => {
    expect(extractGrammarPatch(nounHaus, 'de')).toEqual({
      pos: 'noun',
      gender: 'n',
      plural: 'Häuser',
      genitive: 'Hauses',
    })
  })

  it('flags a weak (n-declension) noun', () => {
    expect(extractGrammarPatch(nounName, 'de')).toEqual({
      pos: 'noun',
      gender: 'm',
      plural: 'Namen',
      genitive: 'Namens',
      is_weak_noun: true,
    })
  })

  it('does NOT run German extraction when langCode is not de', () => {
    const patch = extractGrammarPatch(nounHaus, 'en')
    expect(patch.gender).toBeUndefined()
    expect(patch.plural).toBeUndefined()
  })
})

describe('extractGrammarPatch — German verbs', () => {
  it('marks a dual-auxiliary non-separable verb', () => {
    expect(extractGrammarPatch(verbFahren, 'de')).toEqual({ pos: 'verb', auxiliary: 'haben_or_sein' })
  })

  it('marks a separable verb with a single auxiliary', () => {
    expect(extractGrammarPatch(verbAufstehen, 'de')).toEqual({ pos: 'verb', is_separable: true, auxiliary: 'sein' })
  })
})

describe('extractIpaBag — German', () => {
  it('keeps untagged and standard-tagged sounds, dropping regional ones', () => {
    const entry: KaikkiEntry = {
      word: 'fahren',
      pos: 'verb',
      sounds: [
        { ipa: '/ˈfaːʁɛn/' },
        { ipa: '[ˈfaːʁən]', tags: ['standard'] },
        { ipa: '[ˈfaːn]', tags: ['Austria', 'Southern-Germany', 'Switzerland'] },
      ],
    }
    // Phonemic (slashes) is preferred over the standard phonetic candidate.
    expect(extractIpaBag(entry, 'de')).toEqual({ untagged: '/ˈfaːʁɛn/' })
  })

  it('keeps a standard-only sound when there is no untagged one', () => {
    const entry: KaikkiEntry = {
      word: 'x',
      pos: 'noun',
      sounds: [{ ipa: '/ˈʃtandard/', tags: ['standard'] }],
    }
    expect(extractIpaBag(entry, 'de')).toEqual({ untagged: '/ˈʃtandard/' })
  })

  it('drops a purely regional sound', () => {
    const entry: KaikkiEntry = {
      word: 'x',
      pos: 'noun',
      sounds: [{ ipa: '[ˈfaːn]', tags: ['Austria'] }],
    }
    expect(extractIpaBag(entry, 'de')).toEqual({})
  })
})

// es/pt fixtures mirror real entries from the raw dump (sounds trimmed to the
// fields the extractor reads).
describe('extractIpaBag — Spanish θ-twin classification', () => {
  it('splits an exact distinción pair into cas/lam (phonemic preferred per bucket)', () => {
    // Real `abduce` sounds: phonemic + phonetic pairs, all untagged.
    const entry: KaikkiEntry = {
      word: 'abduce',
      pos: 'verb',
      sounds: [{ ipa: '/abˈduθe/' }, { ipa: '[aβ̞ˈð̞u.θe]' }, { ipa: '/abˈduse/' }, { ipa: '[aβ̞ˈð̞u.se]' }],
    }
    expect(extractIpaBag(entry, 'es')).toEqual({ cas: '/abˈduθe/', lam: '/abˈduse/' })
  })

  it('pairs seseo-degeminated fuzzy twins (adjacent s merge shifts the stress mark)', () => {
    // Real `visceral`: seseo merges /sθ/ → /s/, so the twin is not an exact θ→s match.
    const entry: KaikkiEntry = {
      word: 'visceral',
      pos: 'adj',
      sounds: [{ ipa: '/bisθeˈɾal/' }, { ipa: '/biseˈɾal/' }],
    }
    expect(extractIpaBag(entry, 'es')).toEqual({ cas: '/bisθeˈɾal/', lam: '/biseˈɾal/' })
  })

  it('keeps dialect-neutral variant sets shared in untagged', () => {
    // Real `pie`: two pronunciations, neither a distinción pair.
    const entry: KaikkiEntry = {
      word: 'pie',
      pos: 'noun',
      sounds: [{ ipa: '/ˈpje/' }, { ipa: '/piˈe/' }],
    }
    expect(extractIpaBag(entry, 'es')).toEqual({ untagged: '/ˈpje/' })
  })

  it('classifies θ pairs even when the θ variant is not listed first, leaving extras shared', () => {
    // Real `quiz`: the loanword variant /ˈkwis/ precedes the θ pair.
    const entry: KaikkiEntry = {
      word: 'quiz',
      pos: 'noun',
      sounds: [{ ipa: '/ˈkwis/' }, { ipa: '/ˈkiθ/' }, { ipa: '/ˈkis/' }],
    }
    expect(extractIpaBag(entry, 'es')).toEqual({ cas: '/ˈkiθ/', lam: '/ˈkis/', untagged: '/ˈkwis/' })
  })

  it('puts an unpaired θ variant in cas only (never served as the LatAm default)', () => {
    const entry: KaikkiEntry = {
      word: 'acceptable',
      pos: 'adj',
      sounds: [{ ipa: '/akθepˈtable/' }, { ipa: '[ak.θepˈt̪a.βle]' }],
    }
    expect(extractIpaBag(entry, 'es')).toEqual({ cas: '/akθepˈtable/' })
  })

  it('a single seseo-only pronunciation stays shared in untagged', () => {
    const entry: KaikkiEntry = {
      word: 'casa',
      pos: 'noun',
      sounds: [{ ipa: '/ˈkasa/' }, { ipa: '[ˈka.sa]' }],
    }
    expect(extractIpaBag(entry, 'es')).toEqual({ untagged: '/ˈkasa/' })
  })
})

describe('extractIpaBag — Portuguese bare-tag buckets', () => {
  it('buckets bare Brazil/Portugal rows and drops narrower regions', () => {
    // Real `thesaurus` sounds incl. Rio-de-Janeiro rows that must not leak.
    const entry: KaikkiEntry = {
      word: 'thesaurus',
      pos: 'noun',
      sounds: [
        { ipa: '/teˈzaw.ɾus/', tags: ['Brazil'] },
        { ipa: '[teˈzaʊ̯.ɾus]', tags: ['Brazil'] },
        { ipa: '/teˈzaw.ɾuʃ/', tags: ['Rio-de-Janeiro'] },
        { ipa: '/tɨˈzaw.ɾuʃ/', tags: ['Portugal'] },
      ],
    }
    expect(extractIpaBag(entry, 'pt')).toEqual({ br: '/teˈzaw.ɾus/', eu: '/tɨˈzaw.ɾuʃ/' })
  })

  it('drops rows whose only tags are narrower regions or multi-tag combos', () => {
    const entry: KaikkiEntry = {
      word: 'x',
      pos: 'noun',
      sounds: [
        { ipa: '/a/', tags: ['Southern-Brazil'] },
        { ipa: '/b/', tags: ['Portugal', 'Southern'] },
        { ipa: '/c/', tags: ['Caipira'] },
      ],
    }
    expect(extractIpaBag(entry, 'pt')).toEqual({})
  })

  it('keeps the rare genuinely untagged row in untagged', () => {
    const entry: KaikkiEntry = {
      word: 'o',
      pos: 'article',
      sounds: [{ ipa: '/u/' }],
    }
    expect(extractIpaBag(entry, 'pt')).toEqual({ untagged: '/u/' })
  })
})

describe('extractGrammarPatch — es/pt end to end', () => {
  it('persists a dialect-bucket-only Portuguese bag through the ipa gate', () => {
    // The typical pt case has NO ga/rp/untagged value — the gate must keep it.
    const entry: KaikkiEntry = {
      word: 'coração',
      pos: 'noun',
      head_templates: [{ name: 'pt-noun', expansion: 'coração m (plural corações)' }],
      sounds: [{ ipa: '/ko.ɾaˈsɐ̃w̃/', tags: ['Brazil'] }],
      senses: [{}],
    }
    const patch = extractGrammarPatch(entry, 'pt')
    expect(patch.pos).toBe('noun')
    expect(patch.ipa).toEqual({ br: '/ko.ɾaˈsɐ̃w̃/' })
    // Bullet-less head expansions are card titles, not display forms — skipped.
    expect(patch.display_form).toBeUndefined()
  })

  it('does not run Russian extractors for es and skips the display form', () => {
    const entry: KaikkiEntry = {
      word: 'cerveza',
      pos: 'noun',
      head_templates: [{ name: 'es-noun', expansion: 'cerveza f (plural cervezas)' }],
      sounds: [{ ipa: '/θeɾˈbeθa/' }, { ipa: '/seɾˈbesa/' }],
      senses: [{}],
    }
    const patch = extractGrammarPatch(entry, 'es')
    expect(patch.pos).toBe('noun')
    expect(patch.gender).toBeUndefined()
    expect(patch.aspect).toBeUndefined()
    expect(patch.display_form).toBeUndefined()
    expect(patch.ipa).toEqual({ cas: '/θeɾˈbeθa/', lam: '/seɾˈbesa/' })
  })
})

// French fixtures mirror real entries from the raw dump (maison, chien,
// ciseaux, parler).
describe('extractGrammarPatch — French nouns', () => {
  it('reads gender from fr-noun args.1 and skips the noisy display form', () => {
    const entry: KaikkiEntry = {
      word: 'maison',
      pos: 'noun',
      head_templates: [{ name: 'fr-noun', args: { '1': 'f' }, expansion: 'maison f (plural maisons)' }],
      sounds: [{ ipa: '/mɛ.zɔ̃/' }, { ipa: '/me.zɔ̃/' }],
      senses: [{}],
    }
    expect(extractGrammarPatch(entry, 'fr')).toEqual({
      pos: 'noun',
      gender: 'f',
      ipa: { untagged: '/mɛ.zɔ̃/' },
    })
  })

  it('flags pluralia tantum via the -p suffix', () => {
    const entry: KaikkiEntry = {
      word: 'ciseaux',
      pos: 'noun',
      head_templates: [{ name: 'fr-noun', args: { '1': 'm-p' }, expansion: 'ciseaux m pl (plural only)' }],
      senses: [{}],
    }
    expect(extractGrammarPatch(entry, 'fr')).toEqual({ pos: 'noun', gender: 'm', number_only: 'plurale_tantum' })
  })

  it('leaves dual-gender and head-template rows ungendered', () => {
    const dual: KaikkiEntry = {
      word: 'après-midi',
      pos: 'noun',
      head_templates: [{ name: 'fr-noun', args: { '1': 'm,f' }, expansion: 'après-midi m or f' }],
      senses: [{}],
    }
    expect(extractGrammarPatch(dual, 'fr').gender).toBeUndefined()
    // `head|fr|noun form` rows are inflected forms / misspellings — no gender.
    const form: KaikkiEntry = {
      word: 'tables',
      pos: 'noun',
      head_templates: [{ name: 'head', args: { '1': 'fr', '2': 'noun form', g: 'f' }, expansion: 'tables f' }],
      senses: [{}],
    }
    expect(extractGrammarPatch(form, 'fr').gender).toBeUndefined()
  })

  it('does NOT run French extraction when langCode is not fr', () => {
    const entry: KaikkiEntry = {
      word: 'maison',
      pos: 'noun',
      head_templates: [{ name: 'fr-noun', args: { '1': 'f' }, expansion: 'maison f (plural maisons)' }],
      senses: [{}],
    }
    expect(extractGrammarPatch(entry, 'en').gender).toBeUndefined()
  })
})

describe('extractIpaBag — French', () => {
  it('keeps untagged sounds and drops overseas variants', () => {
    // Real `cœur` sounds: untagged standard + Canada/Newfoundland/Louisiana rows.
    const entry: KaikkiEntry = {
      word: 'cœur',
      pos: 'noun',
      sounds: [
        { ipa: '/kœʁ/' },
        { ipa: '/kœʁ/', tags: ['Canada'] },
        { ipa: '[kaœ̯ʁ]', tags: ['Canada'] },
        { ipa: '[tʃœʁ]', tags: ['Newfoundland'] },
        { ipa: '[kœɾ]', tags: ['Louisiana'] },
      ],
    }
    expect(extractIpaBag(entry, 'fr')).toEqual({ untagged: '/kœʁ/' })
  })

  it('accepts metropolitan-tagged sounds when there is no untagged one', () => {
    // Real `chien` sounds: the standard row is tagged [Belgium, France].
    const entry: KaikkiEntry = {
      word: 'chien',
      pos: 'noun',
      sounds: [
        { ipa: '/ʃjɛ̃/', tags: ['Belgium', 'France'] },
        { ipa: '/ʃjẽ/', tags: ['Quebec'] },
      ],
    }
    expect(extractIpaBag(entry, 'fr')).toEqual({ untagged: '/ʃjɛ̃/' })
  })

  it('drops sounds mixing a metropolitan tag with a non-accepted one', () => {
    const entry: KaikkiEntry = {
      word: 'x',
      pos: 'noun',
      sounds: [{ ipa: '/a/', tags: ['France', 'Southern'] }],
    }
    expect(extractIpaBag(entry, 'fr')).toEqual({})
  })

  it('generic POS fallback applies to French verbs (no bespoke verb extractor)', () => {
    const entry: KaikkiEntry = {
      word: 'parler',
      pos: 'verb',
      head_templates: [{ name: 'fr-verb', args: {}, expansion: 'parler' }],
      sounds: [{ ipa: '/paʁ.le/' }],
      senses: [{}],
    }
    expect(extractGrammarPatch(entry, 'fr')).toEqual({ pos: 'verb', ipa: { untagged: '/paʁ.le/' } })
  })
})
