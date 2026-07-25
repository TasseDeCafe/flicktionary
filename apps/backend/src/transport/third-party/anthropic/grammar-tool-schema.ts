// Per-language assembly of the `grammar` object in the basic-data / enrichment
// tool schemas. Instead of every prompt offering every language's keys (Russian
// aspect on a German card, German auxiliary on a Russian card), each pass calls
// `buildGrammarSchema(targetLanguage)` and the model only sees the keys that
// language actually uses. The key list is the SAME one that drives the focus-
// view editor (`LANGUAGE_GRAMMAR` in core), so the prompt and the UI never
// drift; the per-key JSON fragments + descriptions live here because they are
// LLM-prompt concerns.
//
// Adding a grammar key = add it to `GrammarFieldKey` (core) and to
// `GRAMMAR_KEY_SCHEMA` below — the `Record<GrammarFieldKey, …>` type makes the
// second step a compile error until done.

import {
  getLanguageGrammarConfig,
  UNIVERSAL_GRAMMAR_FIELDS,
  type GrammarFieldKey,
} from '@flicktionary/core/constants/language-grammar'

const POS_ENUM = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'pronoun',
  'particle',
  'conjunction',
  'numeral',
  'phrase',
  'idiom',
  'other',
]

const IPA_DESCRIPTION =
  "IPA transcription of the HEADWORD (citation form, not the inflected surface form). Include for every chunk. For dialect-split targets fill ONLY the dialect bucket the system prompt specifies — English `ga` (General American) / `rp` (Received Pronunciation), Spanish `cas` (Castilian) / `lam` (Latin American), Portuguese `br` (Brazilian) / `eu` (European) — and for every other language fill ONLY `untagged`. Write it the way a dictionary does, with the enclosing delimiters as part of the string: slashes for a phonemic transcription (preferred, e.g. '/səˈliːn/'), square brackets only when giving a narrow phonetic one (e.g. '[sɐzˈdanʲɪje]'). Mark stress. If you are not confident of the transcription, omit the whole `ipa` object rather than guessing."

// One JSON-schema fragment (with its LLM-facing description) per grammar key.
// Iteration order here is the canonical property order in the assembled schema.
// Keys carry their own "when to fill" hint; the deeper per-language rules live
// in the system prompt's language-instructions block.
const GRAMMAR_KEY_SCHEMA: Record<GrammarFieldKey, Record<string, unknown>> = {
  pos: { type: 'string', enum: POS_ENUM, description: 'Part of speech.' },
  display_form: {
    type: 'string',
    description:
      'Canonical-but-decorated form for UI display, e.g. stress-marked Russian `ви́деть`. Keep the headword itself clean.',
  },
  gender: {
    type: 'string',
    enum: ['m', 'f', 'n', 'c'],
    description: 'Grammatical gender. Fill only when it is ambiguous or surprising (per the language guidance).',
  },
  aspect: {
    type: 'string',
    enum: ['impf', 'perf', 'biaspectual'],
    description: 'Verbal aspect (Slavic verbs).',
  },
  aspect_pair_headword: {
    type: 'string',
    description: "The aspectual counterpart's clean lemma.",
  },
  government: {
    type: 'string',
    description: "Case / preposition pattern, e.g. '+ acc', 'от + gen', '+ dat', 'auf + akk'.",
  },
  number_only: {
    type: 'string',
    enum: ['plurale_tantum', 'singulare_tantum'],
    description: 'Nouns that only have one number.',
  },
  animacy: {
    type: 'string',
    enum: ['animate', 'inanimate'],
    description: "Only when it affects the chunk's grammar.",
  },
  is_indeclinable: { type: 'boolean', description: 'True for indeclinable nouns.' },
  is_reflexive: { type: 'boolean', description: 'True for reflexive verbs.' },
  plural: { type: 'string', description: 'Real nominative plural form (the full word, not a suffix).' },
  genitive: { type: 'string', description: 'Real genitive singular form (the full word, not a suffix).' },
  is_weak_noun: { type: 'boolean', description: 'True for German n-declension (weak) nouns.' },
  is_separable: { type: 'boolean', description: 'True for German separable-prefix verbs.' },
  auxiliary: {
    type: 'string',
    enum: ['haben', 'sein', 'haben_or_sein'],
    description: 'German perfect-tense auxiliary.',
  },
  notable_forms: {
    type: 'array',
    description: 'Irregular / notable paradigm cells (max 3).',
    items: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        form: { type: 'string' },
      },
      required: ['label', 'form'],
    },
  },
  ipa: {
    type: 'object',
    description: IPA_DESCRIPTION,
    properties: {
      ga: { type: 'string' },
      rp: { type: 'string' },
      br: { type: 'string' },
      eu: { type: 'string' },
      cas: { type: 'string' },
      lam: { type: 'string' },
      untagged: { type: 'string' },
    },
  },
  notes: { type: 'string', description: 'Free-form, last resort.' },
}

// The keys offered for a given target language: the language's configured fields
// plus the universal core (pos / display_form / ipa / notable_forms / notes),
// so every language can always emit a POS and an IPA even when its config is
// minimal.
const grammarKeysForLanguage = (targetLanguage: string): ReadonlySet<GrammarFieldKey> =>
  new Set<GrammarFieldKey>([...UNIVERSAL_GRAMMAR_FIELDS, ...getLanguageGrammarConfig(targetLanguage).fields])

// Build the `grammar` object schema scoped to one target language. `description`
// is the object-level instruction (it differs slightly between the basic-data
// and enrichment passes).
export const buildGrammarSchema = (
  targetLanguage: string,
  description: string
): { type: 'object'; description: string; properties: Record<string, Record<string, unknown>> } => {
  const keys = grammarKeysForLanguage(targetLanguage)
  const properties: Record<string, Record<string, unknown>> = {}
  for (const key of Object.keys(GRAMMAR_KEY_SCHEMA) as GrammarFieldKey[]) {
    if (keys.has(key)) properties[key] = GRAMMAR_KEY_SCHEMA[key]
  }
  return { type: 'object', description, properties }
}
