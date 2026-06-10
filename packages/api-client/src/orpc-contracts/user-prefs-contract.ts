import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

const TargetLanguagePrefSchema = z.object({
  targetLanguage: z.string(),
  cefrLevel: z.string(),
  showTranslationsEnabled: z.boolean(),
  practiceMaxNewTerms: z.number().int(),
  practiceMaxReviewTerms: z.number().int(),
  // Production review cap. null = uncapped (the historical default for
  // production vocabulary); a number caps distinct production facets
  // reviewed/day. Production has NO new cap by design (opt-in facets bypass
  // daily-new).
  practiceMaxReviewTermsProduction: z.number().int().nullable(),
})

const UserPrefsSchema = z.object({
  nativeLanguage: z.string().nullable(),
  isOnboarded: z.boolean(),
  lastTargetLanguage: z.string().nullable(),
  tapToTranslateEnabled: z.boolean(),
  llmHighlightsEnabled: z.boolean(),
  englishIpaDialect: z.enum(['ga', 'rp']),
  uiTheme: z.enum(['light', 'dark', 'system']).nullable(),
  uiLanguage: z.string().nullable(),
  targetLanguagePrefs: z.array(TargetLanguagePrefSchema),
})

export const PRACTICE_MAX_NEW_TERMS_LIMIT = 100
export const PRACTICE_MAX_REVIEW_TERMS_LIMIT = 300

const PracticeLimitsForLanguageInputSchema = z
  .object({
    targetLanguage: z.string().min(1),
    maxNewTerms: z.number().int().min(0).max(PRACTICE_MAX_NEW_TERMS_LIMIT),
    maxReviewTerms: z.number().int().min(0).max(PRACTICE_MAX_REVIEW_TERMS_LIMIT),
    // Production review cap. null = uncapped (preserves the historical
    // production behavior). Production has no new cap, so the >0 refine below
    // covers only the recognition pair.
    maxReviewTermsProduction: z
      .number()
      .int()
      .min(0)
      .max(PRACTICE_MAX_REVIEW_TERMS_LIMIT)
      .nullable()
      .optional(),
  })
  .refine((value) => value.maxNewTerms + value.maxReviewTerms > 0, {
    message: 'At least one practice term must be allowed.',
    path: ['maxNewTerms'],
  })

export const userPrefsContract = {
  getPrefs: oc
    .route({ method: 'GET', path: '/user-prefs', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .output(z.object({ data: UserPrefsSchema })),

  setNativeLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/native-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ nativeLanguage: z.string().min(1) }))
    .output(z.object({ data: UserPrefsSchema })),

  completeOnboarding: oc
    .route({ method: 'POST', path: '/user-prefs/complete-onboarding', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ nativeLanguage: z.string().min(1) }))
    .output(z.object({ data: UserPrefsSchema })),

  setCefrForLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/cefr-for-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ targetLanguage: z.string().min(1), cefrLevel: z.string().min(1) }))
    .output(z.object({ data: UserPrefsSchema })),

  setTapToTranslateEnabled: oc
    .route({ method: 'PUT', path: '/user-prefs/tap-to-translate', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ enabled: z.boolean() }))
    .output(z.object({ data: UserPrefsSchema })),

  setLlmHighlightsEnabled: oc
    .route({ method: 'PUT', path: '/user-prefs/llm-highlights', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ enabled: z.boolean() }))
    .output(z.object({ data: UserPrefsSchema })),

  setShowTranslationsForLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/show-translations-for-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ targetLanguage: z.string().min(1), enabled: z.boolean() }))
    .output(z.object({ data: UserPrefsSchema })),

  setPracticeLimitsForLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/practice-limits-for-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(PracticeLimitsForLanguageInputSchema)
    .output(z.object({ data: UserPrefsSchema })),

  setEnglishIpaDialect: oc
    .route({ method: 'PUT', path: '/user-prefs/english-ipa-dialect', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ dialect: z.enum(['ga', 'rp']) }))
    .output(z.object({ data: UserPrefsSchema })),

  setUiTheme: oc
    .route({ method: 'PUT', path: '/user-prefs/ui-theme', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ uiTheme: z.enum(['light', 'dark', 'system']).nullable() }))
    .output(z.object({ data: UserPrefsSchema })),

  setUiLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/ui-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ uiLanguage: z.string().min(1).nullable() }))
    .output(z.object({ data: UserPrefsSchema })),
} as const
