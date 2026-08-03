// Per-target-language instructions appended to the cacheable system prefix.
// Stable across all sessions for a given target language — sits inside the cache
// prefix between the static methodology preamble and the per-session blocks.
//
// MVP: hardcoded. v2: editable per user from the settings UI.

export type SpanishIpaDialect = 'cas' | 'lam'
export type PortugueseIpaDialect = 'br' | 'eu'

// Mirrors the user's Spanish IPA dialect preference (users.spanish_ipa_dialect).
// Steers the default variety and which grammar.ipa bucket transcriptions land in.
const buildSpanishDialectBlock = (dialect: SpanishIpaDialect): string =>
  dialect === 'cas'
    ? `- Default register: educated Peninsular (European) Spanish, unless the
  source's regional signals say otherwise.
- IPA transcriptions use Castilian pronunciation (distinción: c/z as /θ/);
  fill the \`cas\` bucket of grammar.ipa. When a word or usage is chiefly
  Latin American, flag it and give the Peninsular equivalent.`
    : `- Default register: educated, neutral Latin-American Spanish (Mexican / pan-LatAm
  news register), unless the source's regional signals say otherwise.
- IPA transcriptions use Latin-American pronunciation (seseo: c/z as /s/);
  fill the \`lam\` bucket of grammar.ipa. When a word or usage is chiefly
  Peninsular, flag it and give the Latin-American equivalent.`

const buildSpanishInstructions = (dialect: SpanishIpaDialect): string => `Spanish-specific guidance:

${buildSpanishDialectBlock(dialect)}
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
  these, flag explicitly in the exploration notes.
- Grammar field usage:
  - grammar.pos — populate for every chunk.
  - grammar.gender — fill for nouns whose gender is not predictable from the
    ending (epicene, common-gender, irregular: 'el problema', 'el agua', 'la
    foto', 'la mano'). Skip when the ending mechanically gives it away.
  - grammar.is_reflexive — true for intrinsically pronominal verbs.
  - grammar.government — when the verb/expression has a fixed preposition that
    a learner would otherwise miss ('depender de', 'soñar con', 'consistir en').`

// Mirrors users.portuguese_ipa_dialect; same role as the Spanish block.
const buildPortugueseDialectBlock = (dialect: PortugueseIpaDialect): string =>
  dialect === 'eu'
    ? `- Default register: educated European Portuguese, unless the source's
  regional signals say otherwise.
- IPA transcriptions use European Portuguese pronunciation; fill the \`eu\`
  bucket of grammar.ipa. When a word or usage is chiefly Brazilian, flag it
  and give the European equivalent.`
    : `- Default register: educated Brazilian Portuguese, unless the source's
  regional signals say otherwise.
- IPA transcriptions use Brazilian Portuguese pronunciation; fill the \`br\`
  bucket of grammar.ipa. When a word or usage is chiefly European Portuguese,
  flag it and give the Brazilian equivalent.`

const buildPortugueseInstructions = (dialect: PortugueseIpaDialect): string => `Portuguese-specific guidance:

${buildPortugueseDialectBlock(dialect)}
- Headword form: infinitive for verbs, including pronominal verbs with the
  hyphenated clitic ('queixar-se', 'lembrar-se de'); singular masculine for
  nouns; lemma + canonical preposition for prepositional collocations. Never
  inflected.
- Grammar field usage:
  - grammar.pos — populate for every chunk.
  - grammar.gender — fill for nouns whose gender is not predictable from the
    ending ('o problema', 'a tribo', 'o mapa'). Skip when the ending
    mechanically gives it away.
  - grammar.is_reflexive — true for intrinsically pronominal verbs.
  - grammar.government — when the verb/expression has a fixed preposition a
    learner would otherwise miss ('gostar de', 'depender de', 'sonhar com').`

const RUSSIAN_INSTRUCTIONS = `Russian-specific guidance:

Headword form is ALWAYS clean: no stress marks, no annotations, no inline
"(m.)" / "+ gen." — those go in the structured \`grammar\` field, not in
the headword. Verbs as imperfective infinitive when paired (with the
perfective counterpart in grammar.aspect_pair_headword); nouns as
nominative singular; prepositional collocations include the canonical
preposition.

Grammar field usage — populate per chunk:

- grammar.pos — REQUIRED for every chunk.

For nouns:
- grammar.gender — fill ONLY when ambiguous or surprising:
  - soft-sign masculines (день, гость, дождь, путь) → m
  - common-gender nouns (сирота, коллега) → c
  - indeclinable foreign nouns (метро, кофе) → fill gender
  Skip when gender is mechanically clear from the ending (-а/-я → f, -о/-е → n,
  hard consonant → m).
- grammar.is_indeclinable — true for indeclinable foreign nouns.
- grammar.number_only — 'plurale_tantum' for деньги / ножницы / часы / сутки /
  каникулы / очки; 'singulare_tantum' for mass nouns when relevant.
- grammar.animacy — only when relevant to the chunk's grammar (typically
  masculine-animate where accusative = genitive).

For verbs:
- grammar.aspect — REQUIRED for every verb chunk: 'impf' | 'perf' | 'biaspectual'.
- grammar.aspect_pair_headword — the counterpart's clean lemma when one is
  commonly paired (видеть ↔ увидеть, упихивать ↔ упихнуть). Omit when there
  is no useful pair or the aspects diverge across senses.
- grammar.government — case + preposition pattern when the verb requires one
  in the source's sense. Format: "от + gen", "с + instr", "к + dat",
  "+ acc", "+ dat", "+ gen", "+ instr", "+ prep". Omit when the verb takes
  bare accusative or has no fixed government in this sense.
- grammar.is_reflexive — true for verbs ending in -ся/-сь.

For all chunks:
- grammar.display_form — stress-marked form for UI display (ви́деть, у́тренний).
  Rules: stress on the stressed vowel via U+0301 combining acute. Skip
  monosyllables (да, нет, шерсть). Skip words containing ё (always stressed).
  For multi-word collocations with ambiguous internal stress, mark only the
  head word or omit entirely.
- grammar.notable_forms — irregular / surprising paradigm cells the learner
  should know up front. Keep tight (1–3 entries max). E.g. for быть:
  [{label:'1sg.fut',form:'буду'}, {label:'past.m',form:'был'}].

Never add accents/annotations to the example sentences. Stress only goes
into grammar.display_form.

Do not duplicate information across grammar and exploration_extras: register
goes only in extras; case government goes only in grammar.government;
etymology only in extras.etymology.`

const GERMAN_INSTRUCTIONS = `German-specific guidance:

Headword form is ALWAYS clean: no article, no annotations. Nouns cite the bare
capitalized singular (\`Bestandteil\`, not \`der Bestandteil\` — the article is
derived from grammar.gender at render time). Verbs cite the infinitive with any
separable prefix JOINED (\`aufstehen\`, \`mitkommen\`, not \`auf stehen\`).
Reflexive verbs include \`sich\` (\`sich freuen\`).

Grammar field usage — populate per chunk:

- grammar.pos — REQUIRED for every chunk.

For nouns:
- grammar.gender — REQUIRED: 'm' | 'f' | 'n' (German has no common gender).
  This drives the displayed article (der/die/das), so never omit it.
- grammar.plural — REQUIRED: the real nominative plural form (\`Bestandteile\`,
  \`Häuser\`, \`Frauen\`). Always the full word, never a suffix; the renderer
  derives the suffix display itself. For plurale-tantum or unchanging plurals,
  give the actual plural form.
- grammar.genitive — REQUIRED: the real genitive singular form (\`Bestandteils\`,
  \`Namens\`, \`Jungen\`). Always the full word. The renderer hides it when it is
  the predictable masc/neut \`-(e)s\` and shows weak/mixed declensions.
- grammar.is_weak_noun — true for n-declension masculines (\`der Junge\` → gen.
  \`Jungen\`, \`der Mensch\`, \`der Name\`). These take \`-(e)n\` in every case
  except nominative singular.
- grammar.number_only — 'plurale_tantum' for \`die Eltern\` / \`die Ferien\` /
  \`die Leute\`; 'singulare_tantum' for mass nouns when relevant.

For verbs:
- grammar.is_separable — true for separable-prefix verbs (\`aufstehen\`,
  \`mitkommen\`, \`anfangen\`). The prefix detaches in main clauses (\`Ich stehe
  auf\`).
- grammar.auxiliary — REQUIRED: 'haben' | 'sein' | 'haben_or_sein'. Use
  'sein' for intransitive verbs of motion / change of state (\`gehen\`,
  \`aufstehen\`), 'haben' for the rest, 'haben_or_sein' when both are correct
  depending on sense (\`fahren\`).
- grammar.is_reflexive — true for verbs that are reflexive in this sense
  (\`sich freuen\`, \`sich erinnern\`).
- grammar.government — case + preposition the learner would otherwise miss.
  Format: "+ dat", "+ akk", "+ gen", "auf + akk", "an + dat", "mit + dat".

For all chunks:
- grammar.notable_forms — principal parts for STRONG / IRREGULAR verbs
  (3rd-person singular present if irregular, preterite, past participle) and
  irregular adjective comparatives/superlatives. Keep tight. E.g. for
  \`fahren\`: [{label:'3sg',form:'fährt'}, {label:'pret',form:'fuhr'},
  {label:'pp',form:'gefahren'}]. Skip entirely for regular weak verbs.
- grammar.display_form — only when a decorated display form helps; usually
  leave unset for German (the citation renderer adds the article).
- grammar.ipa — fill the \`untagged\` bucket with standard German (Hochdeutsch)
  pronunciation.

Do not duplicate information across grammar and exploration_extras: register
goes only in extras; case government goes only in grammar.government;
etymology only in extras.etymology.`

const FRENCH_INSTRUCTIONS = `French-specific guidance:

- Default register: standard metropolitan (European) French, unless the
  source's regional signals say otherwise. When a word or usage is chiefly
  Québécois / Belgian / Swiss (septante, char, blonde, dépanneur), flag it
  and give the metropolitan equivalent.
- Headword form is ALWAYS clean: no article, no annotations. Nouns cite the
  bare singular (\`maison\`, not \`la maison\` — the article is derived from
  grammar.gender at render time). Verbs cite the infinitive; pronominal verbs
  include the clitic in its citation shape (\`se laver\`, \`s'appeler\`,
  \`s'en aller\`). Prepositional collocations include the canonical
  preposition (\`avoir besoin de\`).

Grammar field usage — populate per chunk:

- grammar.pos — REQUIRED for every chunk.

For nouns:
- grammar.gender — REQUIRED: 'm' | 'f'. This drives the displayed article
  (le/la), and French gender is a core learning target — never omit it. For
  dual-gender nouns whose gender tracks the referent (\`élève\`, \`artiste\`)
  or differs by sense (\`un livre\` / \`une livre\`), pick the gender of the
  sense in the source and explain the split in the exploration notes.
- grammar.number_only — 'plurale_tantum' for \`ciseaux\` / \`fiançailles\` /
  \`mœurs\`; 'singulare_tantum' for mass nouns when relevant.

For verbs:
- grammar.is_reflexive — true for pronominal verbs in the relevant sense
  (\`se souvenir\`, \`s'évanouir\`). For optionally-pronominal verbs, the
  headword reflects the sense in the source.
- grammar.government — the fixed preposition a learner would otherwise miss.
  Format: "+ à", "+ de", "à + inf", "de + inf" (\`penser à\`, \`dépendre de\`,
  \`réussir à + inf\`, \`décider de + inf\`). Omit for bare transitives.

For all chunks:
- grammar.notable_forms — irregular / surprising paradigm cells only, kept
  tight (1–3 entries). Irregular plurals (\`œil\` →
  [{label:'plural',form:'yeux'}], \`-al\` → \`-aux\`), irregular feminines
  (\`vieux\` → [{label:'feminine',form:'vieille'}]), and for irregular verbs
  the cells that surprise (\`aller\`: [{label:'1sg.pres',form:'vais'},
  {label:'future',form:'irai'}]). Skip entirely for regular paradigms.
- grammar.ipa — fill the \`untagged\` bucket with standard metropolitan
  pronunciation.
- When an h-initial word is h aspiré (no elision/liaison: \`le haricot\`,
  \`la honte\`), say so in the exploration notes — the headword and grammar
  fields don't encode it.
- grammar.display_form — leave unset; French doesn't use it.

Do not duplicate information across grammar and exploration_extras: register
goes only in extras; preposition government goes only in grammar.government;
etymology only in extras.etymology.`

export type EnglishIpaDialect = 'ga' | 'rp'

// The dialect block mirrors the user's English IPA dialect preference
// (users.english_ipa_dialect). It steers default usage, Briticism/Americanism
// flagging, and the dialect of extras.ipa transcriptions.
const buildEnglishDialectBlock = (dialect: EnglishIpaDialect): string =>
  dialect === 'rp'
    ? `Dialect: the learner prefers British English.
- Default to standard British English usage, spelling, and vocabulary.
- IPA transcriptions use Received Pronunciation (RP).
- When a word or expression is chiefly American, flag it explicitly and give
  the British equivalent.`
    : `Dialect: the learner prefers American English.
- Default to standard American English usage, spelling, and vocabulary.
- IPA transcriptions use General American (GA).
- When a word or expression is chiefly British, flag it explicitly and give
  the American equivalent.`

const buildEnglishInstructions = (dialect: EnglishIpaDialect): string => `English-specific guidance:

${buildEnglishDialectBlock(dialect)}

Headword form for verbs is the marked infinitive: "to practice", "to run
out of", "to look forward to". Always include the "to" — even for phrasal
verbs and prepositional verbs. The "to" goes ONLY in the headword; example
sentences use the natural conjugated form ("She practices every day", not
"She to practices every day").

Other parts of speech: bare singular for nouns (\`child\`, \`foot\`); base
form for adjectives and adverbs; lemma + canonical particle/preposition
for fixed expressions (\`get rid of\`, \`be about to\`).

Grammar field usage — populate when relevant:

- grammar.pos — populate for every chunk.
- grammar.government — for verbs and adjectives that take a fixed
  preposition the learner would otherwise miss: "to depend on" → "+ on",
  "to look forward to" → "+ to (gerund)", "to be afraid of" → "+ of",
  "to insist on" → "+ on (gerund)". Use the simple "+ <particle>" format,
  optionally noting "(gerund)" / "(that-clause)" when the complement type
  matters.
- grammar.notable_forms — irregular paradigm cells the learner needs up
  front. Keep tight (1–3 entries max).
  Verbs: past + past participle for irregulars only — e.g. for "to go":
  [{label:'past',form:'went'}, {label:'past_participle',form:'gone'}];
  for "to be": [{label:'past',form:'was/were'}, {label:'past_participle',form:'been'}].
  Skip entirely for regular verbs (\`-ed\` paradigm).
  Nouns: irregular plural — \`child\` → [{label:'plural',form:'children'}];
  \`foot\` → [{label:'plural',form:'feet'}].
  Adjectives: irregular comparative/superlative — \`good\` →
  [{label:'comparative',form:'better'}, {label:'superlative',form:'best'}].
- grammar.number_only — for nouns that don't behave normally:
  'plurale_tantum' for \`scissors\` / \`trousers\` / \`glasses\` / \`clothes\`;
  'singulare_tantum' for uncountables that look plural (\`news\`,
  \`mathematics\`, \`physics\`).
- grammar.is_reflexive — leave unset; English doesn't mark reflexivity at
  the lemma level (reflexive pronouns are syntactic, not lexical).
- grammar.gender, grammar.aspect, grammar.animacy, grammar.display_form —
  leave unset; English doesn't use them.`

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  ru: RUSSIAN_INSTRUCTIONS,
  rus: RUSSIAN_INSTRUCTIONS,
  russian: RUSSIAN_INSTRUCTIONS,
  de: GERMAN_INSTRUCTIONS,
  deu: GERMAN_INSTRUCTIONS,
  german: GERMAN_INSTRUCTIONS,
  fr: FRENCH_INSTRUCTIONS,
  fra: FRENCH_INSTRUCTIONS,
  french: FRENCH_INSTRUCTIONS,
}

// The dialect pick for whichever dialect-split language the session targets —
// the value is also the grammar bag bucket the model is told to fill. Each
// value yields its own stable cache-prefix variant, same as the English
// GA/RP split always has.
export type TargetIpaDialect = 'ga' | 'rp' | 'cas' | 'lam' | 'br' | 'eu'

export const isEnglishTargetLanguage = (targetLanguage: string): boolean =>
  ['en', 'eng', 'english'].includes(targetLanguage.trim().toLowerCase())

export const getLanguageInstructions = (
  targetLanguage: string,
  opts: { ipaDialect?: TargetIpaDialect } = {}
): string | null => {
  const key = targetLanguage.trim().toLowerCase()
  if (isEnglishTargetLanguage(targetLanguage)) {
    return buildEnglishInstructions(opts.ipaDialect === 'rp' ? 'rp' : 'ga')
  }
  if (['es', 'spa', 'spanish'].includes(key)) {
    return buildSpanishInstructions(opts.ipaDialect === 'cas' ? 'cas' : 'lam')
  }
  if (['pt', 'por', 'portuguese'].includes(key)) {
    return buildPortugueseInstructions(opts.ipaDialect === 'eu' ? 'eu' : 'br')
  }
  return LANGUAGE_INSTRUCTIONS[key] ?? null
}
