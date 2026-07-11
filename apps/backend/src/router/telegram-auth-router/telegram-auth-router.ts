import { Router } from 'express'
import { implement } from '@orpc/server'
import NodeCache from 'node-cache'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import { telegramAuthContract } from '@flicktionary/api-client/orpc-contracts/telegram-auth-contract'
import { getSupabase } from '../../transport/database/supabase'
import { getConfig } from '../../config/environment-config'
import { TelegramAuthNoncesRepositoryInterface } from '../../transport/database/telegram-auth-nonces/telegram-auth-nonces-repository'
import { AuthUsersRepository } from '../../transport/database/auth-users/auth-users-repository'

// The endpoint is unauthenticated (the nonce is the credential), so throttle
// exchange attempts per IP. Nonces are UUIDs — unguessable — but this keeps a
// misbehaving client from hammering the Supabase admin API.
const exchangeAttemptsByIp = new NodeCache({ stdTTL: 10 * 60 })
const MAX_ATTEMPTS_PER_WINDOW = 20

export const TelegramAuthRouter = (
  noncesRepository: TelegramAuthNoncesRepositoryInterface,
  authUsersRepository: AuthUsersRepository
): Router => {
  const implementer = implement(telegramAuthContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    exchangeNonce: implementer.exchangeNonce.handler(async ({ input, context, errors }) => {
      if (getConfig().shouldRateLimit) {
        const ip = context.req.ip ?? 'unknown'
        const attempts = exchangeAttemptsByIp.get<number>(ip) ?? 0
        if (attempts >= MAX_ATTEMPTS_PER_WINDOW) {
          throw errors.TOO_MANY_REQUESTS({
            data: { errors: [{ message: 'Too many sign-in attempts — try again later' }] },
          })
        }
        exchangeAttemptsByIp.set(ip, attempts + 1)
      }

      const consumed = await noncesRepository.consume(input.nonce)
      if (!consumed) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'Sign-in link expired or already used' }] },
        })
      }

      const authUser = await authUsersRepository.findUserById(consumed.userId)
      if (!authUser?.email) {
        throw errors.BAD_REQUEST({
          data: { errors: [{ message: 'No account found for this sign-in link' }] },
        })
      }

      const { data, error } = await getSupabase().auth.admin.generateLink({
        type: 'magiclink',
        email: authUser.email,
      })

      if (error || !data?.properties?.hashed_token) {
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [{ message: error?.message ?? 'Failed to mint session token' }],
          },
        })
      }

      return {
        data: {
          tokenHash: data.properties.hashed_token,
          email: authUser.email,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: telegramAuthContract })
}
