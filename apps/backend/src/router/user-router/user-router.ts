import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { DbUser, UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { processReferral } from './user-router-utils'
import { userContract } from '@template-app/api-client/orpc-contracts/user-contract'

export const UserRouter = (usersRepository: UsersRepositoryInterface): Router => {
  const implementer = implement(userContract).$context<OrpcContext>()

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

    putUser: implementer.putUser.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const { referral, utmSource, utmMedium, utmCampaign, utmTerm, utmContent } = input

      const dbUser: DbUser | null = await usersRepository.findUserByUserId(userId)

      if (!dbUser) {
        const processedReferral = processReferral(referral)
        const hasInsertedSuccessfully = await usersRepository.insertUser(userId, processedReferral, {
          utmSource: utmSource || null,
          utmMedium: utmMedium || null,
          utmCampaign: utmCampaign || null,
          utmTerm: utmTerm || null,
          utmContent: utmContent || null,
        })
        if (!hasInsertedSuccessfully) {
          throw errors.INTERNAL_SERVER_ERROR({
            data: {
              errors: [{ message: 'An error occurred while inserting the user.' }],
            },
          })
        }
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
