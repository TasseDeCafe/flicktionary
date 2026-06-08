const DEFAULT_PRACTICE_MAX_NEW_TERMS = 20
const DEFAULT_PRACTICE_MAX_REVIEW_TERMS = 100

type UserPrefsWithTargetLanguages = {
  targetLanguagePrefs: Array<{
    targetLanguage: string
    practiceMaxNewTerms: number
    practiceMaxReviewTerms: number
    practiceMaxReviewTermsActive: number | null
  }>
}

export type PracticeLimits = {
  maxNewTerms: number
  maxReviewTerms: number
  // Production (active) review cap. null = uncapped (the historical default).
  maxReviewTermsActive: number | null
}

export const getPracticeLimitsForLanguage = (
  prefs: UserPrefsWithTargetLanguages | null | undefined,
  targetLanguage: string | null | undefined
): PracticeLimits => {
  const pref = targetLanguage ? prefs?.targetLanguagePrefs.find((p) => p.targetLanguage === targetLanguage) : undefined
  return {
    maxNewTerms: pref?.practiceMaxNewTerms ?? DEFAULT_PRACTICE_MAX_NEW_TERMS,
    maxReviewTerms: pref?.practiceMaxReviewTerms ?? DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
    maxReviewTermsActive: pref?.practiceMaxReviewTermsActive ?? null,
  }
}
