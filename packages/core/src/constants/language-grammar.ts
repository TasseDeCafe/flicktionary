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
    },
  },
  es: {
    fields: ['pos', 'gender', 'is_reflexive', 'government', 'number_only', 'notable_forms', 'notes'],
    hints: { government: { placeholder: 'e.g. + de, + a' } },
  },
  en: {
    fields: ['pos', 'display_form', 'government', 'number_only', 'notable_forms', 'notes'],
    hints: {
      display_form: {
        label: 'Pronunciation hint (stress / IPA)',
        placeholder: 'e.g. PHO·to·graph or /ˈfoʊtəɡræf/',
      },
      government: { placeholder: 'e.g. + on, + with' },
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

export const getLanguageGrammarConfig = (code: string | undefined | null): LanguageGrammarConfig => {
  if (!code) return DEFAULT_GRAMMAR_CONFIG
  return LANGUAGE_GRAMMAR[code as SupportedLanguageCode] ?? DEFAULT_GRAMMAR_CONFIG
}
