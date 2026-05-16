import type { SupportedLanguageCode } from './supported-languages'

export type GrammarFieldKey =
  | 'pos'
  | 'display_form'
  | 'gender'
  | 'aspect'
  | 'aspect_pair_headword'
  | 'government'
  | 'number_only'
  | 'animacy'
  | 'is_indeclinable'
  | 'is_reflexive'
  | 'notable_forms'
  | 'notes'
  | 'ipa'

export type FieldHint = { label?: string; placeholder?: string }

export type LanguageGrammarConfig = {
  fields: ReadonlyArray<GrammarFieldKey>
  hints?: Partial<Record<GrammarFieldKey, FieldHint>>
}

export const DEFAULT_GRAMMAR_CONFIG: LanguageGrammarConfig = {
  fields: ['pos', 'display_form', 'government', 'number_only', 'notable_forms', 'notes'],
}

export const LANGUAGE_GRAMMAR: Partial<Record<SupportedLanguageCode, LanguageGrammarConfig>> = {
  ru: {
    fields: [
      'pos',
      'display_form',
      'ipa',
      'gender',
      'aspect',
      'aspect_pair_headword',
      'government',
      'number_only',
      'animacy',
      'is_indeclinable',
      'is_reflexive',
      'notable_forms',
      'notes',
    ],
    hints: {
      display_form: { label: 'Display form (stress-marked)', placeholder: 'e.g. ви́деть' },
      aspect_pair_headword: { placeholder: 'e.g. увидеть' },
      government: { placeholder: 'e.g. + acc, от + gen' },
      ipa: { label: 'IPA' },
    },
  },
  es: {
    fields: ['pos', 'gender', 'is_reflexive', 'government', 'number_only', 'notable_forms', 'notes'],
    hints: { government: { placeholder: 'e.g. + de, + a' } },
  },
  en: {
    fields: ['pos', 'ipa', 'government', 'number_only', 'notable_forms', 'notes'],
    hints: {
      government: { placeholder: 'e.g. + on, + with' },
      ipa: { label: 'IPA' },
    },
  },
  fr: {
    fields: [
      'pos',
      'display_form',
      'gender',
      'is_reflexive',
      'government',
      'number_only',
      'notable_forms',
      'notes',
    ],
    hints: {
      display_form: { label: 'Pronunciation hint (IPA)', placeholder: 'e.g. /paʁ.le/' },
      government: { placeholder: 'e.g. + à, + de' },
    },
  },
  pt: {
    fields: ['pos', 'gender', 'is_reflexive', 'government', 'number_only', 'notable_forms', 'notes'],
    hints: { government: { placeholder: 'e.g. + de, + a, + em' } },
  },
}

// Languages whose `card.chunk.grammar` is grounded against a kaikki Wiktionary
// dump in the backend. Mirror of `KAIKKI_ENABLED_LANGUAGES` in
// apps/backend/src/service/wiktionary-grounding/config.ts. Used by the focus
// view to decide whether to render a "Wiktionary" / "LLM only" badge —
// languages outside the set get no badge, since the absence of grounding is
// the default state and doesn't need explanation.
export const KAIKKI_LANGUAGES: ReadonlySet<string> = new Set(['ru', 'en'])

export const getLanguageGrammarConfig = (code: string | undefined | null): LanguageGrammarConfig => {
  if (!code) return DEFAULT_GRAMMAR_CONFIG
  return LANGUAGE_GRAMMAR[code as SupportedLanguageCode] ?? DEFAULT_GRAMMAR_CONFIG
}

// Fields that are meaningful for any part of speech (when the language lists
// them at all). The POS-specific additions below layer on top of this set.
const UNIVERSAL_FIELDS: ReadonlyArray<GrammarFieldKey> = [
  'pos',
  'display_form',
  'ipa',
  'notable_forms',
  'notes',
]

// Additional fields that only apply to a specific POS. Linguistically
// motivated, not language-specific: verbs have aspect; nouns have gender;
// adjectives don't have either. The language config still decides which keys
// even exist for that language — this map only narrows further by POS.
//
// POS values not listed here (phrase / idiom / other) intentionally fall
// through to "no narrowing" — those categories are catch-alls where we can't
// safely hide fields the user might want.
const POS_SPECIFIC_FIELDS: Record<string, ReadonlyArray<GrammarFieldKey>> = {
  noun: ['gender', 'number_only', 'animacy', 'is_indeclinable', 'government'],
  verb: ['aspect', 'aspect_pair_headword', 'is_reflexive', 'government'],
  adjective: ['government'],
  adverb: [],
  preposition: ['government'],
  pronoun: ['gender', 'number_only'],
  particle: [],
  conjunction: [],
  numeral: ['gender'],
}

// Returns the language's allowed fields, narrowed by part of speech when we
// have a confident classification (`noun` / `verb` / `adjective` / etc.).
// When `pos` is null/undefined or falls into the catch-all bucket
// (`phrase` / `idiom` / `other` / unknown string), no POS narrowing happens —
// the caller gets the full language allowlist.
export const getEffectiveGrammarFields = (
  code: string | undefined | null,
  pos: string | null | undefined
): ReadonlyArray<GrammarFieldKey> => {
  const langFields = getLanguageGrammarConfig(code).fields
  if (!pos) return langFields
  const posSpecific = POS_SPECIFIC_FIELDS[pos]
  if (!posSpecific) return langFields
  const allowed = new Set<GrammarFieldKey>([...UNIVERSAL_FIELDS, ...posSpecific])
  return langFields.filter((f) => allowed.has(f))
}
