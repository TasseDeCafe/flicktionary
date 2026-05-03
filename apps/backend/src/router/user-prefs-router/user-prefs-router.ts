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
  tapToTranslateEnabled: boolean
  llmHighlightsEnabled: boolean
  targetLanguagePrefs: { targetLanguage: string; cefrLevel: string }[]
}

const buildPrefs = async (
  userId: string,
  usersRepository: UsersRepositoryInterface,
  prefsRepository: UserTargetLanguagePrefsRepositoryInterface
): Promise<UserPrefsResponse> => {
  const [nativeLanguage, tapToTranslateEnabled, llmHighlightsEnabled, targetPrefs] = await Promise.all([
    usersRepository.getNativeLanguage(userId),
    usersRepository.getTapToTranslateEnabled(userId),
    usersRepository.getLlmHighlightsEnabled(userId),
    prefsRepository.listForUser(userId),
  ])
  return {
    nativeLanguage,
    tapToTranslateEnabled,
    llmHighlightsEnabled,
    targetLanguagePrefs: targetPrefs.map((p) => ({
      targetLanguage: p.target_language,
      cefrLevel: p.cefr_level,
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
  })

  return createOrpcExpressRouter(router, { contract: userPrefsContract })
}
