import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { extensionAuthContract } from '@flicktionary/api-client/orpc-contracts/extension-auth-contract'
import { getSupabase } from '../../transport/database/supabase'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { ExtensionPairNoncesRepositoryInterface } from '../../transport/database/extension-pair-nonces/extension-pair-nonces-repository'

const NONCE_TTL_SECONDS = 120

export const ExtensionAuthRouter = (
  noncesRepository: ExtensionPairNoncesRepositoryInterface,
  usersRepository: UsersRepositoryInterface,
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
): Router => {
  const implementer = implement(extensionAuthContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    mintSession: implementer.mintSession.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const email = context.res.locals.email as string | undefined

      if (!email) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Authenticated user has no email on file' }] },
        })
      }

      const claimed = await noncesRepository.claim(input.nonce, userId, NONCE_TTL_SECONDS)
      if (!claimed) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Pairing nonce already used or invalid' }] },
        })
      }

      const { data, error } = await getSupabase().auth.admin.generateLink({
        type: 'magiclink',
        email,
      })

      if (error || !data?.properties?.hashed_token) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [
              {
                message: error?.message ?? 'Failed to mint extension session token',
              },
            ],
          },
        })
      }

      return {
        data: {
          tokenHash: data.properties.hashed_token,
          email,
        },
      }
    }),

    revokeSession: implementer.revokeSession.handler(async ({ context }) => {
      const authHeader = context.req.headers.authorization ?? ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
      if (!token) {
        return { data: { revoked: false } }
      }

      const { error } = await getSupabase().auth.admin.signOut(token)
      return { data: { revoked: !error } }
    }),

    bootstrapPrefs: implementer.bootstrapPrefs.handler(async ({ context }) => {
      const userId = context.res.locals.userId
      const email = (context.res.locals.email as string | undefined) ?? ''

      const [nativeLanguage, isOnboarded, lastTargetLanguage, targetPrefs] = await Promise.all([
        usersRepository.getNativeLanguage(userId),
        usersRepository.getIsOnboarded(userId),
        usersRepository.getLastTargetLanguage(userId),
        userTargetLanguagePrefsRepository.listForUser(userId),
      ])

      const primaryTargetLanguage = lastTargetLanguage ?? targetPrefs[0]?.target_language ?? null
      const cefrLevel =
        targetPrefs.find((p) => p.target_language === primaryTargetLanguage)?.cefr_level ??
        targetPrefs[0]?.cefr_level ??
        null

      return {
        data: {
          primaryTargetLanguage,
          nativeLanguage,
          cefrLevel,
          email,
          isOnboarded,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: extensionAuthContract })
}
