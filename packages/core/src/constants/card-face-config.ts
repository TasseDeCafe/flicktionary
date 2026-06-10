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
  | 'translation' // headword translation (L1); presence-based — with translations OFF it only exists if manually entered
  | 'nativeExample' // example translation; presence-based, same rule
  | 'definition' // target-language definition; primary gloss when translations are OFF, fallback gloss otherwise
  | 'grammar' // GrammarChips (already POS+language filtered)

export type CardFaceConfig = {
  front: readonly CardSlotKey[]
  back: readonly CardSlotKey[]
  // When true, the front renders the headword without combining stress marks
  // (U+0301) and the stressed display_form swaps in on reveal — for languages
  // (Russian) where stress position is part of the answer.
  hideStressOnFront?: boolean
}

// Back order is definition-first: definition and translation only co-render
// in the translations-OFF + manual-translation case, where definition stays
// the primary (immersion-first) gloss. With translations ON only one of the
// two resolves, so the order is invisible there.
export const DEFAULT_CARD_FACE_CONFIG: CardFaceConfig = {
  front: ['headword', 'targetExample'],
  back: ['definition', 'translation', 'nativeExample', 'grammar'],
}

// Production cards flip the direction: the front prompts with the gloss —
// translation, or definition as the fallback per the same resolver rules as
// the default back — plus the example translation; the back reveals the term,
// its pronunciation and the target example. Language-independent: the ipa
// slot falls out naturally for languages without an ipa bag, and stress never
// needs hiding because the headword only appears on the back. A card with no
// gloss data at all resolves to an empty front — callers fall back to the
// recognition layout for that card.
export const ACTIVE_CARD_FACE_CONFIG: CardFaceConfig = {
  front: ['definition', 'translation', 'nativeExample'],
  back: ['headword', 'ipa', 'targetExample', 'grammar'],
}

// Languages absent here use the default. ru/en (Kaikki languages) carry a
// Wiktionary-grounded `grammar.ipa`; other languages have no ipa bag and the
// slot falls out naturally via pickIpa. English surfaces IPA on the front
// (spelling doesn't give pronunciation away); Russian defers it to the back —
// stress position + IPA *are* part of the answer on a recognition card, so
// the front shows the unstressed form and reveals both with the back.
export const LANGUAGE_CARD_FACE: Partial<Record<SupportedLanguageCode, CardFaceConfig>> = {
  ru: {
    front: ['headword', 'targetExample'],
    back: ['ipa', 'definition', 'translation', 'nativeExample', 'grammar'],
    hideStressOnFront: true,
  },
  en: {
    front: ['headword', 'ipa', 'targetExample'],
    back: ['definition', 'translation', 'nativeExample', 'grammar'],
  },
}

export const getCardFaceConfig = (
  code: string | undefined | null,
  pool: 'recognition' | 'production' = 'recognition'
): CardFaceConfig => {
  if (pool === 'production') return ACTIVE_CARD_FACE_CONFIG
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

// Drop slots whose data is missing or whose condition excludes them.
// translation/nativeExample are presence-based: with translations OFF they are
// never auto-generated, so a stored value is a manual one the user wants on
// the card. Definition stays the primary gloss when translations are hidden
// (manual translation renders below it) and is the fallback gloss when
// translations are on but the card has no translation — so a gloss always
// appears if any exists.
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
        return cond.hasTranslation
      case 'nativeExample':
        return cond.hasNativeExample
      case 'definition':
        return (cond.hideTranslationFields || !cond.hasTranslation) && cond.hasDefinition
      case 'grammar':
        return cond.hasGrammarChips
      default:
        return false
    }
  })
