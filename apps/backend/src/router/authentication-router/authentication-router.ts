import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { getSupabase } from '../../transport/database/supabase'
import { getConfig } from '../../config/environment-config'
import { authenticationContract } from '@template-app/api-client/orpc-contracts/authentication-contract'
import NodeCache from 'node-cache'

// Create rate limit caches outside the function so they persist across requests
const emailRateLimitCache10Min = new NodeCache({ stdTTL: 10 * 60 }) // 10 minutes TTL
const emailRateLimitCacheDaily = new NodeCache({ stdTTL: 60 * 60 }) // 1 hour TTL

export const authenticationRouter = (): Router => {
  const implementer = implement(authenticationContract).$context<OrpcContext>()

  const authRouter = implementer.router({
    sendEmailVerification: implementer.sendEmailVerification.handler(async ({ input, errors }) => {
      // Apply email-based rate limiting
      if (getConfig().shouldRateLimit) {
        const email = input.email

        let count10Min = emailRateLimitCache10Min.get<number>(email) || 0
        if (count10Min >= 10) {
          throw errors.INTERNAL_SERVER_ERROR({
            data: {
              errors: [
                { message: 'Too many verification attempts for this email. Please try again later.', code: '40' },
              ],
            },
          })
        }
        emailRateLimitCache10Min.set(email, count10Min + 1)

        let countDaily = emailRateLimitCacheDaily.get<number>(email) || 0
        if (countDaily >= 20) {
          throw errors.INTERNAL_SERVER_ERROR({
            data: {
              errors: [
                { message: 'Daily verification limit reached for this email. Please try again tomorrow.', code: '41' },
              ],
            },
          })
        }
        emailRateLimitCacheDaily.set(email, countDaily + 1)
      }

      try {
        // We pass the platform here because it is ephemeral and shouldn't be stored in the user metadata
        // Supabase will only pass the metadata at user creation. Subsequent sign ins will not pass them.
        // TODO: we need to pass the referral here too, otherwise it is stripped when signing in from the native app
        const emailRedirectTo = `${getConfig().webUrl}/login/email/verify?`
        const params = {
          email: input.email,
          options: {
            emailRedirectTo: emailRedirectTo,
            shouldCreateUser: true,
            // This data is stored in the auth table in the user metadata
            data: {
              referral: input.referral,
              utmSource: input.utmSource,
              utmMedium: input.utmMedium,
              utmCampaign: input.utmCampaign,
              utmTerm: input.utmTerm,
              utmContent: input.utmContent,
            },
          },
        }

        const { error } = await getSupabase().auth.signInWithOtp(params)

        if (error) {
          logWithSentry({
            message: 'Error sending verification email',
            params: {
              email: input.email,
              referral: input.referral,
              utmSource: input.utmSource,
              utmMedium: input.utmMedium,
              utmCampaign: input.utmCampaign,
              utmTerm: input.utmTerm,
              utmContent: input.utmContent,
              platform: input.platform,
            },
            error: error,
          })
          throw errors.INTERNAL_SERVER_ERROR({
            data: {
              errors: [{ message: 'Failed to send verification email', code: '20' }],
            },
          })
        }

        return {
          data: {
            message: 'Verification email sent successfully',
          },
        }
      } catch (error) {
        logWithSentry({
          message: 'Unexpected error when sending verification email',
          params: {
            email: input.email,
            referral: input.referral,
            utmSource: input.utmSource,
            utmMedium: input.utmMedium,
            utmCampaign: input.utmCampaign,
            utmTerm: input.utmTerm,
            utmContent: input.utmContent,
            platform: input.platform,
          },
          error: error,
        })
        throw errors.INTERNAL_SERVER_ERROR({
          data: {
            errors: [{ message: 'Failed to send verification email', code: '30' }],
          },
        })
      }
    }),
  })

  // Note: IP-based rate limiting (thirtyRequestsPerDayRateLimit, tenRequestsIn10MinutesRateLimit)
  // should be applied at the app level for the /authentication path specifically,
  // not here, to avoid affecting other routes mounted at /api/v1
  // Email-based rate limiting is handled inside the handler above

  return createOrpcExpressRouter(authRouter, { contract: authenticationContract })
}
