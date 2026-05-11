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

// Languages whose `card.chunk.grammar` is grounded against a kaikki Wiktionary
// dump in the backend. Mirror of `KAIKKI_ENABLED_LANGUAGES` in
// apps/backend/src/service/wiktionary-grounding/config.ts. Used by the focus
// view to decide whether to render a "Wiktionary" / "LLM only" badge —
// languages outside the set get no badge, since the absence of grounding is
// the default state and doesn't need explanation.
export const KAIKKI_LANGUAGES: ReadonlySet<string> = new Set(['ru'])

export const getLanguageGrammarConfig = (code: string | undefined | null): LanguageGrammarConfig => {
  if (!code) return DEFAULT_GRAMMAR_CONFIG
  return LANGUAGE_GRAMMAR[code as SupportedLanguageCode] ?? DEFAULT_GRAMMAR_CONFIG
}
