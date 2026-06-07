const DEFAULT_PRACTICE_MAX_NEW_TERMS = 20
const DEFAULT_PRACTICE_MAX_REVIEW_TERMS = 100

type UserPrefsWithTargetLanguages = {
  targetLanguagePrefs: Array<{
    targetLanguage: string
    practiceMaxNewTerms: number
    practiceMaxReviewTerms: number
  }>
}

export type PracticeLimits = {
  maxNewTerms: number
  maxReviewTerms: number
}

export const getPracticeLimitsForLanguage = (
  prefs: UserPrefsWithTargetLanguages | null | undefined,
  targetLanguage: string | null | undefined
): PracticeLimits => {
  const pref = targetLanguage ? prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === targetLanguage) : undefined
  return {
    maxNewTerms: pref?.practiceMaxNewTerms ?? DEFAULT_PRACTICE_MAX_NEW_TERMS,
    maxReviewTerms: pref?.practiceMaxReviewTerms ?? DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  }
}
