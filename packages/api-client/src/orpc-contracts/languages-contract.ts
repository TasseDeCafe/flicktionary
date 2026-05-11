import { oc } from '@orpc/contract'
import { z } from 'zod'
import { supportedLanguageCodeSchema } from '@flicktionary/core/constants/supported-languages'
import { BackendErrorResponseSchema } from './common/error-response-schema'

export const languagesContract = {
  detect: oc
    .route({ method: 'POST', path: '/languages/detect', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({ text: z.string().min(1).max(20_000) }))
    .output(z.object({ data: z.object({ code: supportedLanguageCodeSchema.nullable() }) })),
} as const
