import { z } from 'zod'

export const BackendErrorDetailsSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
})

export const BackendErrorResponseSchema = z.object({
  errors: z.array(BackendErrorDetailsSchema).optional(),
})

export type BackendErrorDetails = z.infer<typeof BackendErrorDetailsSchema>
export type BackendErrorResponse = z.infer<typeof BackendErrorResponseSchema>
