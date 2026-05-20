type UserPrefsWithTargetLanguages = {
  targetLanguagePrefs: Array<{
    targetLanguage: string
    showTranslationsEnabled: boolean
  }>
}

export const getShowTranslationsEnabledForLanguage = (
  prefs: UserPrefsWithTargetLanguages | null | undefined,
  targetLanguage: string | null | undefined
): boolean => {
  if (!targetLanguage) return true
  return prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === targetLanguage)?.showTranslationsEnabled ?? true
}
