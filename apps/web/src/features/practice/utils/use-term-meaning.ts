import { useHideTranslationFields } from './use-hide-translation-fields'

// Resolves a term's one-line meaning for exercise hints and post-answer
// reminder lines, under the same rules as flashcard faces: the translation
// leads, but when L1 = L2 or the per-language Show-translations pref is off,
// only the (target-language) definition may show.
export const useTermMeaning = (targetLanguage: string) => {
  const hideTranslationFields = useHideTranslationFields(targetLanguage)

  return (term: { translation: string | null; definition: string | null }): string | null =>
    hideTranslationFields ? term.definition : (term.translation ?? term.definition)
}
