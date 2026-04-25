'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ENGLISH_LOCALE, FRENCH_LOCALE, POLISH_LOCALE, SPANISH_LOCALE } from '@/lib/i18n/i18n-config'
import { CircleFlagLanguage } from 'react-circle-flags'

const LanguageSwitcher = () => {
  const pathname = usePathname()

  // replaces locale in a url, for example: /en/pricing -> /pl/pricing
  const getLanguagePath = (locale: string) => {
    const segments = pathname.split('/')
    segments[1] = locale
    return segments.join('/')
  }

  return (
    <div className='flex space-x-4'>
      <Link href={getLanguagePath(ENGLISH_LOCALE)}>
        <CircleFlagLanguage languageCode={ENGLISH_LOCALE} className='h-5 w-5 cursor-pointer' />
      </Link>
      <Link href={getLanguagePath(SPANISH_LOCALE)}>
        <CircleFlagLanguage languageCode={SPANISH_LOCALE} className='h-5 w-5 cursor-pointer' />
      </Link>
      <Link href={getLanguagePath(POLISH_LOCALE)}>
        <CircleFlagLanguage languageCode={POLISH_LOCALE} className='h-5 w-5 cursor-pointer' />
      </Link>
      <Link href={getLanguagePath(FRENCH_LOCALE)}>
        <CircleFlagLanguage languageCode={FRENCH_LOCALE} className='h-5 w-5 cursor-pointer' />
      </Link>
    </div>
  )
}

export default LanguageSwitcher
