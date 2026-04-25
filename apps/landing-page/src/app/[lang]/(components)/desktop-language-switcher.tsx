'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ENGLISH_LOCALE, FRENCH_LOCALE, POLISH_LOCALE, SPANISH_LOCALE } from '@/lib/i18n/i18n-config'
import { CircleFlagLanguage } from 'react-circle-flags'

const languages = [
  { code: ENGLISH_LOCALE, name: 'English' },
  { code: SPANISH_LOCALE, name: 'Español' },
  { code: POLISH_LOCALE, name: 'Polski' },
  { code: FRENCH_LOCALE, name: 'Français' },
]

type DesktopLanguageSwitcherProps = {
  lang: string
}

const DesktopLanguageSwitcher = ({ lang }: DesktopLanguageSwitcherProps) => {
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false)
  const pathname = usePathname()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const toggleLanguageMenu = () => setIsLanguageMenuOpen(!isLanguageMenuOpen)

  const getLanguagePath = (locale: string) => {
    const segments = pathname.split('/')
    segments[1] = locale
    return segments.join('/')
  }

  const currentLanguage = languages.find((l) => l.code === lang) || languages[0]

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLanguageMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className='relative' ref={dropdownRef}>
      <button
        onClick={toggleLanguageMenu}
        className='flex items-center justify-center rounded-full p-1 hover:bg-gray-100'
      >
        <CircleFlagLanguage languageCode={currentLanguage.code} className='h-5 w-5' />
      </button>
      {isLanguageMenuOpen && (
        <div className='ring-opacity-5 absolute right-0 mt-2 w-48 rounded-md bg-gray-50 shadow-lg ring-1 ring-black'>
          {languages.map((language) => (
            <Link
              key={language.code}
              href={getLanguagePath(language.code)}
              className='flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100'
              onClick={() => setIsLanguageMenuOpen(false)}
            >
              <CircleFlagLanguage languageCode={language.code} className='mr-2 h-5 w-5' />
              {language.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default DesktopLanguageSwitcher
