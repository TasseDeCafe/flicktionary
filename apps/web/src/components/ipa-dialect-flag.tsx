import type { IpaDialects } from '@flicktionary/core/utils/pick-ipa'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// One emoji + aria label per (language, dialect) pick. Languages without a
// dialect split render nothing — the flag marks WHICH variety an IPA string
// is, so it only makes sense where the user has a choice.
const DIALECT_FLAGS: Record<string, Record<string, { flag: string; label: string }>> = {
  en: {
    ga: { flag: '🇺🇸', label: 'General American' },
    rp: { flag: '🇬🇧', label: 'Received Pronunciation' },
  },
  es: {
    lam: { flag: '🌎', label: 'Latin American Spanish' },
    cas: { flag: '🇪🇸', label: 'Castilian Spanish' },
  },
  pt: {
    br: { flag: '🇧🇷', label: 'Brazilian Portuguese' },
    eu: { flag: '🇵🇹', label: 'European Portuguese' },
  },
}

type Props = {
  targetLanguage: string | null | undefined
  ipaDialects: IpaDialects
  className?: string
}

export const IpaDialectFlag = ({ targetLanguage, ipaDialects, className }: Props) => {
  if (!targetLanguage) return null
  const byDialect = DIALECT_FLAGS[targetLanguage]
  if (!byDialect) return null
  const dialect = ipaDialects[targetLanguage as keyof IpaDialects]
  const entry = byDialect[dialect]
  if (!entry) return null
  return (
    <span className={cn('inline-block leading-none', className)} role='img' aria-label={entry.label}>
      {entry.flag}
    </span>
  )
}
