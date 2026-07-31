import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { DbUser, UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { processReferral } from './user-router-utils'
import { userContract } from '@flicktionary/api-client/orpc-contracts/user-contract'
import { getConfig } from '../../config/environment-config'

const buildSeedFromEmail = (
  email: string | undefined
): { nativeLanguage: string; isOnboarded: boolean } | undefined => {
  if (!email) return undefined
  const { devAutoSeedEmailPattern, devAutoSeedNativeLanguage } = getConfig()
  if (!devAutoSeedEmailPattern) return undefined
  if (!devAutoSeedEmailPattern.test(email)) return undefined
  return { nativeLanguage: devAutoSeedNativeLanguage, isOnboarded: true }
}

export const UserRouter = (usersRepository: UsersRepositoryInterface): Router => {
  const implementer = implement(userContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    getUser: implementer.getUser.handler(async ({ context, errors }) => {
      const userId = context.res.locals.userId

      const dbUser = await usersRepository.findUserByUserId(userId)
      if (!dbUser) {
        throw errors.NOT_FOUND({
          data: {
            errors: [{ message: 'User not found' }],
          },
        })
      }
      return {
        data: {
          referral: dbUser.referral,
          utmSource: dbUser.utm_source,
          utmMedium: dbUser.utm_medium,
          utmCampaign: dbUser.utm_campaign,
          utmTerm: dbUser.utm_term,
          utmContent: dbUser.utm_content,
        },
      }
    }),

    putUser: implementer.putUser.handler(async ({ input, context }) => {
      const userId = context.res.locals.userId
      const { referral, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, nativeLanguage } = input

      const dbUser: DbUser | null = await usersRepository.findUserByUserId(userId)

      if (!dbUser) {
        const processedReferral = processReferral(referral)
        // Guests never see the onboarding wizard: seed the browser-detected
        // native language (defaulting to English) and mark them onboarded so
        // the web app's onboarding gate lets them straight through. They can
        // change the language later in settings.
        const seed = context.res.locals.isAnonymous
          ? { nativeLanguage: nativeLanguage ?? 'en', isOnboarded: true }
          : buildSeedFromEmail(context.res.locals.email)
        await usersRepository.insertUser(
          userId,
          processedReferral,
          {
            utmSource: utmSource || null,
            utmMedium: utmMedium || null,
            utmCampaign: utmCampaign || null,
            utmTerm: utmTerm || null,
            utmContent: utmContent || null,
          },
          seed
        )
        return {
          data: {
            referral: referral ?? null,
            utmSource: utmSource ?? null,
            utmMedium: utmMedium ?? null,
            utmCampaign: utmCampaign ?? null,
            utmTerm: utmTerm ?? null,
            utmContent: utmContent ?? null,
          },
        }
      }
      return {
        data: {
          referral: dbUser.referral,
          utmSource: dbUser.utm_source,
          utmMedium: dbUser.utm_medium,
          utmCampaign: dbUser.utm_campaign,
          utmTerm: dbUser.utm_term,
          utmContent: dbUser.utm_content,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: userContract })
}
