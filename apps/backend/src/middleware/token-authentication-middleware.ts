import { NextFunction, Request, Response } from 'express'
import {
  ERROR_CODE_FOR_GUEST_ACCESS_DISABLED,
  ERROR_CODE_FOR_INVALID_TOKEN,
} from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import { ORPCError } from '@orpc/server'
import { setRequestContext } from '../context/request-context'
import { verifySupabaseToken } from '../utils/jwt-verification-utils'

export interface SupabaseClaims {
  sub: string
  // Present on tokens minted by Supabase anonymous sign-ins. Anonymous users
  // have no email and their metadata can be empty, hence the optional fields.
  is_anonymous?: boolean
  user_metadata?: {
    name?: string
    full_name?: string
    email?: string
    avatar_url?: string
  }
}

// todo orpc: ideally we should be chaining an oRPC middleware to the implementers in each
// router to safely type the context and return oRPC errors.
// this way, variables like userId would be typed correctly in the routers.
export const tokenAuthenticationMiddleware =
  ({ isGuestModeEnabled }: { isGuestModeEnabled: boolean }) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split('Bearer ')[1]
    if (!token) {
      const orpcError = new ORPCError('UNAUTHORIZED', {
        message: "Access token is missing or the 'authorization' header was not provided",
        data: {
          errors: [
            {
              message: "Access token is missing or the 'authorization' header was not provided",
              code: '20',
            },
          ],
        },
      })
      res.status(orpcError.status).json(orpcError.toJSON())
      return
    } else {
      try {
        const decoded = await verifySupabaseToken(token)
        const { sub, is_anonymous: isAnonymous = false, user_metadata = {} } = decoded
        const { name, full_name, email, avatar_url } = user_metadata

        // The kill switch locks out existing guest sessions too: the token is
        // cryptographically valid, but anonymous access is administratively off.
        // The distinct code lets the web app sign the guest out and land on
        // /login instead of showing an error state.
        if (isAnonymous && !isGuestModeEnabled) {
          const orpcError = new ORPCError('UNAUTHORIZED', {
            message: 'Guest access is disabled',
            data: {
              errors: [
                {
                  message: 'Guest access is disabled',
                  code: ERROR_CODE_FOR_GUEST_ACCESS_DISABLED,
                },
              ],
            },
          })
          res.status(orpcError.status).json(orpcError.toJSON())
          return
        }

        res.locals.name = name
        res.locals.userId = sub
        res.locals.lastName = full_name
        res.locals.email = email
        res.locals.imageUrl = avatar_url
        res.locals.isAnonymous = isAnonymous
        setRequestContext({ userId: sub, isAnonymous })
        return next()
      } catch {
        const orpcError = new ORPCError('UNAUTHORIZED', {
          message: 'Invalid token',
          data: {
            errors: [
              {
                message: 'Invalid token',
                code: ERROR_CODE_FOR_INVALID_TOKEN,
              },
            ],
          },
        })
        res.status(orpcError.status).json(orpcError.toJSON())
        return
      }
    }
  }
