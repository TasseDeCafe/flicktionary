import { msg } from '@lingui/core/macro'
import type { I18n, MessageDescriptor } from '@lingui/core'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'

// Language names are user-facing copy too. Keeping descriptors in one map
// lets chips and headings share the active interface language instead of
// interpolating the English names from the core metadata.
export const coverageLanguageNameMessages: Record<string, MessageDescriptor> = {
  en: msg`English`,
  zh: msg`Chinese`,
  hi: msg`Hindi`,
  es: msg`Spanish`,
  ar: msg`Arabic`,
  fr: msg`French`,
  bn: msg`Bengali`,
  pt: msg`Portuguese`,
  ru: msg`Russian`,
  ur: msg`Urdu`,
  id: msg`Indonesian`,
  de: msg`German`,
  ja: msg`Japanese`,
  sw: msg`Swahili`,
  mr: msg`Marathi`,
  te: msg`Telugu`,
  tr: msg`Turkish`,
  ta: msg`Tamil`,
  vi: msg`Vietnamese`,
  ko: msg`Korean`,
}

export const getLocalizedCoverageLanguageName = (i18n: I18n, code: string): string => {
  const descriptor = coverageLanguageNameMessages[code]
  return descriptor ? i18n._(descriptor) : getLanguageName(code)
}
