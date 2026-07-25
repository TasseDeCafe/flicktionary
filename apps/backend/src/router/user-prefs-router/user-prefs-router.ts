import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import {
  userPrefsContract,
  AccountFlagSchema,
  type AccountFlag,
} from '@flicktionary/api-client/orpc-contracts/user-prefs-contract'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { PracticeExercisesRepositoryInterface } from '../../transport/database/practice-exercises/practice-exercises-repository'

type UserPrefsResponse = {
  nativeLanguage: string | null
  isOnboarded: boolean
  lastTargetLanguage: string | null
  tapToTranslateEnabled: boolean
  llmHighlightsEnabled: boolean
  englishIpaDialect: 'ga' | 'rp'
  spanishIpaDialect: 'cas' | 'lam'
  portugueseIpaDialect: 'br' | 'eu'
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
  accountFlags: AccountFlag[]
}

// The column has no DB-level value constraint, so filter to contract-known
// flags — an unknown value (e.g. after a rollback to an older server) must
// not fail output validation.
const toKnownAccountFlags = (flags: string[]): AccountFlag[] =>
  flags.filter((flag): flag is AccountFlag => AccountFlagSchema.options.includes(flag as AccountFlag))

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
    ipaDialects,
    uiTheme,
    uiLanguage,
    targetPrefs,
    accountFlags,
  ] = await Promise.all([
    usersRepository.getNativeLanguage(userId),
    usersRepository.getIsOnboarded(userId),
    usersRepository.getLastTargetLanguage(userId),
    usersRepository.getTapToTranslateEnabled(userId),
    usersRepository.getLlmHighlightsEnabled(userId),
    usersRepository.getIpaDialects(userId),
    usersRepository.getUiTheme(userId),
    usersRepository.getUiLanguage(userId),
    prefsRepository.listForUser(userId),
    usersRepository.getAccountFlags(userId),
  ])
  return {
    nativeLanguage,
    isOnboarded,
    lastTargetLanguage,
    tapToTranslateEnabled,
    llmHighlightsEnabled,
    englishIpaDialect: ipaDialects.en,
    spanishIpaDialect: ipaDialects.es,
    portugueseIpaDialect: ipaDialects.pt,
    uiTheme,
    uiLanguage,
    accountFlags: toKnownAccountFlags(accountFlags),
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
  prefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  studySessionsRepository: StudySessionsRepositoryInterface,
  userLookupsRepository: UserLookupsRepositoryInterface,
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface,
  practiceExercisesRepository: PracticeExercisesRepositoryInterface
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

    setIpaDialect: implementer.setIpaDialect.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      // The contract's discriminated union already ties dialect values to the
      // language, so the repository can trust the pair.
      const ok = await usersRepository.setIpaDialect(userId, input.targetLanguage, input.dialect)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to update IPA dialect' }] },
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

    addAccountFlag: implementer.addAccountFlag.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const ok = await usersRepository.addAccountFlag(userId, input.flag)
      if (!ok) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: { errors: [{ message: 'Failed to add account flag' }] },
        })
      }
      const prefs = await buildPrefs(userId, usersRepository, prefsRepository)
      return { data: prefs }
    }),

    gettingStartedStatus: implementer.gettingStartedStatus.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const [hasSession, hasSavedWords, hasLiveRatingEvent, hasUsedExercise] = await Promise.all([
        studySessionsRepository.hasVisibleSession(userId),
        userLookupsRepository.hasKeptLookup(userId),
        practiceRatingEventsRepository.hasLiveEvent(userId),
        practiceExercisesRepository.hasUsedExercise(userId),
      ])
      return {
        data: {
          hasSession,
          hasSavedWords,
          hasPracticed: hasLiveRatingEvent || hasUsedExercise,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: userPrefsContract })
}
