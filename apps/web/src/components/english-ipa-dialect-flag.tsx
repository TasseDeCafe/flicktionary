import type { EnglishIpaDialect } from '@flicktionary/core/utils/pick-ipa'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Props = {
  targetLanguage: string | null | undefined
  englishIpaDialect: EnglishIpaDialect
  className?: string
}

export const EnglishIpaDialectFlag = ({ targetLanguage, englishIpaDialect, className }: Props) => {
  if (targetLanguage !== 'en') return null
  const flag = englishIpaDialect === 'ga' ? '🇺🇸' : '🇬🇧'
  const label = englishIpaDialect === 'ga' ? 'General American' : 'Received Pronunciation'
  return (
    <span className={cn('inline-block leading-none', className)} role='img' aria-label={label}>
      {flag}
    </span>
  )
}
