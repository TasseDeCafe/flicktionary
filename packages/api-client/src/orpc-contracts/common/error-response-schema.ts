import { z } from 'zod'

export const BackendErrorDetailsSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
  // Machine-readable context for codes that drive a client recovery flow.
  // e.g. MISSING_CEFR carries the detected target language so the extension
  // can offer an inline CEFR picker instead of just a dead-end message.
  targetLanguage: z.string().optional(),
})

export const BackendErrorResponseSchema = z.object({
  errors: z.array(BackendErrorDetailsSchema).optional(),
})

export type BackendErrorDetails = z.infer<typeof BackendErrorDetailsSchema>
export type BackendErrorResponse = z.infer<typeof BackendErrorResponseSchema>
