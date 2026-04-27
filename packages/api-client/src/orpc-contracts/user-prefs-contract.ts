import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

const TargetLanguagePrefSchema = z.object({
  targetLanguage: z.string(),
  cefrLevel: z.string(),
})

const UserPrefsSchema = z.object({
  nativeLanguage: z.string().nullable(),
  tapToTranslateEnabled: z.boolean(),
  targetLanguagePrefs: z.array(TargetLanguagePrefSchema),
})

export const userPrefsContract = {
  getPrefs: oc
    .route({ method: 'GET', path: '/user-prefs', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .output(z.object({ data: UserPrefsSchema })),

  setNativeLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/native-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ nativeLanguage: z.string().min(1) }))
    .output(z.object({ data: UserPrefsSchema })),

  setCefrForLanguage: oc
    .route({ method: 'PUT', path: '/user-prefs/cefr-for-language', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ targetLanguage: z.string().min(1), cefrLevel: z.string().min(1) }))
    .output(z.object({ data: UserPrefsSchema })),

  setTapToTranslateEnabled: oc
    .route({ method: 'PUT', path: '/user-prefs/tap-to-translate', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ enabled: z.boolean() }))
    .output(z.object({ data: UserPrefsSchema })),
} as const
