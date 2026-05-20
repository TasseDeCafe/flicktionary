export type LanguageOutputMode = {
  hideTranslationFields: boolean
  allowL1Notes: boolean
}

export const sanitizeExplorationExtrasForLanguageMode = (
  extras: Record<string, unknown> | null | undefined,
  mode: Pick<LanguageOutputMode, 'allowL1Notes'>
): Record<string, unknown> | null => {
  if (!extras) return null
  const sanitized = { ...extras }
  if (!mode.allowL1Notes) {
    sanitized.l1_notes = null
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null
}

export const sanitizeTextFieldsForLanguageMode = <
  T extends { translation?: string | null; nativeExample?: string | null },
>(
  fields: T,
  mode: Pick<LanguageOutputMode, 'hideTranslationFields'>
): T => {
  if (!mode.hideTranslationFields) return fields
  return {
    ...fields,
    translation: null,
    nativeExample: null,
  }
}
