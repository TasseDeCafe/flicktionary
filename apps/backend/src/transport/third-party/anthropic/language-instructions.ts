// Per-target-language instructions appended to the cacheable system prefix.
// Stable across all sessions for a given target language — sits inside the cache
// prefix between the static methodology preamble and the per-session blocks.
//
// MVP: hardcoded. v2: editable per user from the settings UI.

const SPANISH_INSTRUCTIONS = `Spanish-specific guidance:

- Default register: educated, neutral Latin-American Spanish (Mexican / pan-LatAm
  news register), unless the source's regional signals say otherwise.
- Regional sensitivity:
  - Rioplatense / Argentinian (voseo, "che", lunfardo, "vos sos / tenés / querés",
    "acá / allá" over "aquí / allí", "boludo", "pibe", "laburar", "quilombo"):
    when the source skews regional, prioritize regional vocabulary and
    collocations over their pan-LatAm equivalents. Flag voseo conjugations
    explicitly in headword form (e.g. headword 'tener' but note voseo "tenés").
  - Peninsular (vosotros, leísmo, "tío / tía", "vale", "molar"): mark as such
    and note the LatAm equivalent.
  - Mexican / Caribbean / Andean: flag idiosyncratic vocabulary; otherwise treat
    as neutral.
- Headword form: infinitive for verbs (including pronominal: 'fundirse con',
  'darse cuenta de'); singular masculine for nouns; lemma + canonical
  preposition for prepositional collocations. Never inflected.
- Reflexive / pronominal verbs: include the 'se' in the headword when the verb
  is intrinsically pronominal in the relevant sense ('fundirse', 'darse',
  'acordarse de'). For optionally-reflexive verbs, headword reflects the sense
  in the source.
- Subjunctive / aspect / clitic placement: when a chunk's difficulty hinges on
  these, flag explicitly in the exploration notes.`

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  es: SPANISH_INSTRUCTIONS,
  spa: SPANISH_INSTRUCTIONS,
  spanish: SPANISH_INSTRUCTIONS,
}

export const getLanguageInstructions = (targetLanguage: string): string | null => {
  const key = targetLanguage.trim().toLowerCase()
  return LANGUAGE_INSTRUCTIONS[key] ?? null
}
