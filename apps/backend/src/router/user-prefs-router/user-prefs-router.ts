import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { userPrefsContract } from '@flicktionary/api-client/orpc-contracts/user-prefs-contract'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'

type UserPrefsResponse = {
  nativeLanguage: string | null
  isOnboarded: boolean
  lastTargetLanguage: string | null
  tapToTranslateEnabled: boolean
  llmHighlightsEnabled: boolean
  englishIpaDialect: 'ga' | 'rp'
  uiTheme: 'light' | 'dark' | 'system' | null
  uiLanguage: string | null
  targetLanguagePrefs: {
    targetLanguage: string
    cefrLevel: string
    showTranslationsEnabled: boolean
    practiceMaxNewTerms: number
    practiceMaxReviewTerms: number
    practiceMaxReviewTermsProduction: number | null
  }[]
}

const buildPrefs = async (
  userId: string,
  usersRepository: UsersRepositoryInterface,
  prefsRepository: UserTargetLanguagePrefsRepositoryInterface
): Promise<UserPrefsResponse> => {
  const [
    nativeLanguage,
    isOnboarded,
    lastTargetLanguage,
    tapToTranslateEnabled,
    llmHighlightsEnabled,
    englishIpaDialect,
    uiTheme,
    uiLanguage,
    targetPrefs,
  ] = await Promise.all([
    usersRepository.getNativeLanguage(userId),
    usersRepository.getIsOnboarded(userId),
    usersRepository.getLastTargetLanguage(userId),
    usersRepository.getTapToTranslateEnabled(userId),
    usersRepository.getLlmHighlightsEnabled(userId),
    usersRepository.getEnglishIpaDialect(userId),
    usersRepository.getUiTheme(userId),
    usersRepository.getUiLanguage(userId),
    prefsRepository.listForUser(userId),
  ])
  return {
    nativeLanguage,
    isOnboarded,
    lastTargetLanguage,
    tapToTranslateEnabled,
    llmHighlightsEnabled,
    englishIpaDialect,
    uiTheme,
    uiLanguage,
    targetLanguagePrefs: targetPrefs.map((p) => ({
      targetLanguage: p.target_language,
      cefrLevel: p.cefr_level,
      showTranslationsEnabled: p.show_translations_enabled,
      practiceMaxNewTerms: p.practice_max_new_terms,
      practiceMaxReviewTerms: p.practice_max_review_terms,
      practiceMaxReviewTermsProduction: p.practice_max_review_terms_production,
    })),
  }
}

export const UserPrefsRouter = (
  usersRepository: UsersRepositoryInterface,
  prefsRepository: UserTargetLanguagePrefsRepositoryInterface
): Router => {
  const implementer = implement(userPrefsContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    getPrefs: implementer.getPrefs.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setNativeLanguage: implementer.setNativeLanguage.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.setNativeLanguage(userId, input.nativeLanguage)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to set native language' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    completeOnboarding: implementer.completeOnboarding.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.completeOnboarding(userId, input.nativeLanguage)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to complete onboarding' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setCefrForLanguage: implementer.setCefrForLanguage.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      await prefsRepository.upsertCefr(userId, input.targetLanguage, input.cefrLevel)
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setTapToTranslateEnabled: implementer.setTapToTranslateEnabled.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.setTapToTranslateEnabled(userId, input.enabled)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update tap-to-translate setting' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setLlmHighlightsEnabled: implementer.setLlmHighlightsEnabled.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.setLlmHighlightsEnabled(userId, input.enabled)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update LLM highlights setting' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setShowTranslationsForLanguage: implementer.setShowTranslationsForLanguage.handler(
      async ({ input, context, errors }) => {
        const userId = context.res.locals.userId
        const ok = await prefsRepository.setShowTranslationsEnabled(userId, input.targetLanguage, input.enabled)
        if (!ok) {
          throw errors.INTERNAL_SERVER_ERROR({
            data: { errors: [{ message: 'Failed to update show-translations setting' }] },
          })
        }
        const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
        return { data: prefs }
      }
    ),

    setPracticeLimitsForLanguage: implementer.setPracticeLimitsForLanguage.handler(
      async ({ input, context, errors }) => {
        const userId = context.res.locals.userId
        const ok = await prefsRepository.setPracticeLimitsForLanguage(userId, input.targetLanguage, {
          maxNewTerms: input.maxNewTerms,
          maxReviewTerms: input.maxReviewTerms,
          maxReviewTermsProduction: input.maxReviewTermsProduction ?? null,
        })
        if (!ok) {
          throw errors.INTERNAL_SERVER_ERROR({
            data: { errors: [{ message: 'Failed to update practice limits' }] },
          })
        }
        const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
        return { data: prefs }
      }
    ),

    setEnglishIpaDialect: implementer.setEnglishIpaDialect.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.setEnglishIpaDialect(userId, input.dialect)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update English IPA dialect' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setUiTheme: implementer.setUiTheme.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.setUiTheme(userId, input.uiTheme)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update UI theme' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    setUiLanguage: implementer.setUiLanguage.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.setUiLanguage(userId, input.uiLanguage)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update UI language' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),
  })

  return createOrpcExpressRouter(router, { contract: userPrefsContract })
}
