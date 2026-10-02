import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'

// True when a practice surface may only show target-language meanings: L1 =
// L2, or the per-language Show-translations pref is off. Shared by flashcard
// faces, exercise meaning lines and the production Clue gate.
export const useHideTranslationFields = (targetLanguage: string): boolean => {
  const { data: userPrefs } = useGetUserPrefs()
  const nativeLanguage = userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  return sameLanguage || !getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
}
