import type { SupportedLanguageCode } from './supported-languages'

// Abstract data slots that can appear on a flashcard face. These are *what
// data* to show, not *whether* to show it — the runtime conditions (translation
// mode, IPA availability, populated fields) decide inclusion in resolveCardSlots
// below. Languages differ only in slot ordering/inclusion, declared in
// LANGUAGE_CARD_FACE; everything situational stays out of the per-language map.
export type CardSlotKey =
  | 'headword' // target headword (display_form when present)
  | 'ipa' // pickIpa(grammar.ipa, lang, dialect); renders only if available
  | 'targetExample' // target-language example sentence
  | 'translation' // headword translation (L1); only when !hideTranslationFields
  | 'nativeExample' // example translation; only when !hideTranslationFields
  | 'definition' // target-language definition; the L1=L2 / translations-OFF gloss
  | 'grammar' // GrammarChips (already POS+language filtered)

export type CardFaceConfig = { front: readonly CardSlotKey[]; back: readonly CardSlotKey[] }

export const DEFAULT_CARD_FACE_CONFIG: CardFaceConfig = {
  front: ['headword', 'targetExample'],
  back: ['translation', 'definition', 'nativeExample', 'grammar'],
}

// Languages absent here use the default. ru/en (Kaikki languages) carry a
// Wiktionary-grounded `grammar.ipa`, so they surface IPA on the front; other
// languages have no ipa bag and the slot falls out naturally via pickIpa.
export const LANGUAGE_CARD_FACE: Partial<Record<SupportedLanguageCode, CardFaceConfig>> = {
  ru: {
    front: ['headword', 'ipa', 'targetExample'],
    back: ['translation', 'definition', 'nativeExample', 'grammar'],
  },
  en: {
    front: ['headword', 'ipa', 'targetExample'],
    back: ['translation', 'definition', 'nativeExample', 'grammar'],
  },
}

export const getCardFaceConfig = (code: string | undefined | null): CardFaceConfig => {
  if (!code) return DEFAULT_CARD_FACE_CONFIG
  return LANGUAGE_CARD_FACE[code as SupportedLanguageCode] ?? DEFAULT_CARD_FACE_CONFIG
}

// Runtime conditions the resolver filters slots against. Derived per card from
// the user's prefs (translation mode) and the card's populated fields.
export type CardSlotConditions = {
  hideTranslationFields: boolean
  hasIpa: boolean
  hasTargetExample: boolean
  hasNativeExample: boolean
  hasTranslation: boolean
  hasDefinition: boolean
  hasGrammarChips: boolean
}

// Drop slots whose data is missing or whose condition excludes them. The
// translation/definition fork mirrors rate-sheet.tsx's `translation ||
// definition` gloss behaviour: definition shows when translations are hidden
// AND as the fallback gloss when translations are on but the card has no
// translation — so a gloss always appears if any exists.
export const resolveCardSlots = (slots: readonly CardSlotKey[], cond: CardSlotConditions): CardSlotKey[] =>
  slots.filter((slot) => {
    switch (slot) {
      case 'headword':
        return true
      case 'ipa':
        return cond.hasIpa
      case 'targetExample':
        return cond.hasTargetExample
      case 'translation':
        return !cond.hideTranslationFields && cond.hasTranslation
      case 'nativeExample':
        return !cond.hideTranslationFields && cond.hasNativeExample
      case 'definition':
        return (cond.hideTranslationFields || !cond.hasTranslation) && cond.hasDefinition
      case 'grammar':
        return cond.hasGrammarChips
      default:
        return false
    }
  })
