// Pulls the structured `{ code, message }` out of an oRPC error thrown by the
// Flicktionary API client. Backend procedures return their domain code inside
// `data.errors[0]` (e.g. 'UNSUPPORTED_LANGUAGE', 'MISSING_CEFR'); the oRPC
// client surfaces that payload on the thrown ORPCError's `.data`.
export interface FlicktionaryApiError {
  code?: string
  message: string
  // Present on codes that carry recovery context (e.g. 'MISSING_CEFR' →
  // the detected target language the client should let the user set a level for).
  targetLanguage?: string
}

export const extractFlicktionaryApiError = (error: unknown, fallbackMessage: string): FlicktionaryApiError => {
  const data = (
    error as { data?: { errors?: Array<{ code?: string; message?: string; targetLanguage?: string }> } } | undefined
  )?.data
  const first = data?.errors?.[0]
  if (first) {
    return { code: first.code, message: first.message ?? fallbackMessage, targetLanguage: first.targetLanguage }
  }
  if (error instanceof Error && error.message) {
    return { message: error.message }
  }
  return { message: fallbackMessage }
}
