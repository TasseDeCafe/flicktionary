import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'

// Resolves a term's one-line meaning for exercise hints and post-answer
// reminder lines, under the same rules as flashcard faces: the translation
// leads, but when L1 = L2 or the per-language Show-translations pref is off,
// only the (target-language) definition may show.
export const useTermMeaning = (targetLanguage: string) => {
  const { data: userPrefs } = useGetUserPrefs()
  const nativeLanguage = userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const hideTranslationFields = sameLanguage || !getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)

  return (term: { translation: string | null; definition: string | null }): string | null =>
    hideTranslationFields ? term.definition : (term.translation ?? term.definition)
}
