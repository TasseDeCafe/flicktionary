import { oc } from '@orpc/contract'
import { z } from 'zod'
import { supportedLanguageCodeSchema } from '@flicktionary/core/constants/supported-languages'
import { BackendErrorResponseSchema } from './common/error-response-schema'

export const USER_PATH = '/users/me' as const

const UserDataSchema = z.object({
  referral: z.string().nullable(),
  utmSource: z.string().nullable(),
  utmMedium: z.string().nullable(),
  utmCampaign: z.string().nullable(),
  utmTerm: z.string().nullable(),
  utmContent: z.string().nullable(),
})

export const userContract = {
  getUser: oc
    .route({
      method: 'GET',
      path: USER_PATH,
      successStatus: 200,
    })
    .errors({
      NOT_FOUND: {
        status: 404,
        data: BackendErrorResponseSchema,
      },
      INTERNAL_SERVER_ERROR: {
        status: 500,
        data: BackendErrorResponseSchema,
      },
    })
    .output(
      z.object({
        data: UserDataSchema,
      })
    ),

  putUser: oc
    .route({
      method: 'PUT',
      path: USER_PATH,
      successStatus: 200,
    })
    .errors({
      INTERNAL_SERVER_ERROR: {
        status: 500,
        data: BackendErrorResponseSchema,
      },
    })
    .input(
      z.object({
        referral: z.string().nullable().optional(),
        utmSource: z.string().nullable().optional(),
        utmMedium: z.string().nullable().optional(),
        utmCampaign: z.string().nullable().optional(),
        utmTerm: z.string().nullable().optional(),
        utmContent: z.string().nullable().optional(),
        // Browser-detected native language, sent only for anonymous (guest)
        // sessions: guests skip the onboarding wizard, so provisioning seeds
        // native_language + is_onboarded from this instead. Ignored for
        // regular users, whose onboarding sets the value explicitly.
        nativeLanguage: supportedLanguageCodeSchema.optional(),
      })
    )
    .output(
      z.object({
        data: UserDataSchema,
      })
    ),
} as const
