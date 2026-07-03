// The wizards' shared auto-detect contract: a Haiku language-detection result
// only takes effect (applied silently in the text wizard, offered as a hint in
// the adhoc wizard) while the user hasn't manually picked a language — an
// explicit pick always wins — and only when it would actually change the
// current selection.
export const shouldUseDetectedLanguage = ({
  detectedCode,
  currentLanguage,
  languageTouched,
}: {
  detectedCode: string | null | undefined
  currentLanguage: string | null
  languageTouched: boolean
}): boolean => !languageTouched && !!detectedCode && detectedCode !== currentLanguage
