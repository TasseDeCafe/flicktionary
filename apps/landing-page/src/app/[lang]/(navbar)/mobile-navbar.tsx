'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Zap } from 'lucide-react'
import { LangProps } from '@/types/lang-props'
import { ButtonLeadingToWebapp } from '@/app/[lang]/(components)/(leading-to-apps)/button-leading-to-webapp'
import { ENGLISH_LOCALE, FRENCH_LOCALE, POLISH_LOCALE, SPANISH_LOCALE } from '@/lib/i18n/i18n-config'
import { Trans } from '@lingui/react/macro'
import { CircleFlagLanguage } from 'react-circle-flags'

type MobileNavLinkProps = {
  href: string
  children: ReactNode
  icon: ReactNode
  onClick?: () => void
  isExternal?: boolean
}

const MobileNavLink = ({ href, children, icon, onClick, isExternal = false }: MobileNavLinkProps) => (
  <div className='w-full rounded-md transition-colors active:bg-indigo-100'>
    <Link
      href={href}
      className='flex w-full items-center px-4 py-2 text-2xl text-gray-600 transition-colors active:text-indigo-600'
      onClick={onClick}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <span className='mr-4'>{icon}</span>
      {children}
    </Link>
  </div>
)

const MobileNavbar = ({ lang }: LangProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false)
  const pathname = usePathname()

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen)
  const toggleLanguageMenu = () => setIsLanguageMenuOpen(!isLanguageMenuOpen)

  const getLanguagePath = (locale: string) => {
    const segments = pathname.split('/')
    segments[1] = locale
    return segments.join('/')
  }

  useEffect(() => {
    if (isMenuOpen) {
      document.body.classList.add('overflow-hidden')
    } else {
      document.body.classList.remove('overflow-hidden')
    }

    return () => {
      document.body.classList.remove('overflow-hidden')
    }
  }, [isMenuOpen])

  const languages = [
    { code: ENGLISH_LOCALE, name: 'English' },
    { code: SPANISH_LOCALE, name: 'Español' },
    { code: FRENCH_LOCALE, name: 'Français' },
    { code: POLISH_LOCALE, name: 'Polski' },
  ]

  const currentLanguage = languages.find((l) => l.code === lang) || languages[0]

  return (
    <div className='lg:hidden'>
      <button className='px-4' onClick={toggleMenu} aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}>
        {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {isMenuOpen && (
        <div className='absolute top-full left-0 z-50 h-screen w-full bg-gray-50 px-4 py-4 shadow-lg shadow-indigo-100/50'>
          <div className='flex w-full flex-col space-y-2'>
            <MobileNavLink href={`/${lang}/pricing`} icon={<Zap size={24} />} onClick={toggleMenu}>
              <Trans>Pricing</Trans>
            </MobileNavLink>
            <div className='relative'>
              <button
                onClick={toggleLanguageMenu}
                className='flex w-full items-center justify-between rounded-md bg-gray-50 px-4 py-2 text-2xl text-gray-600'
              >
                <span className='flex items-center'>
                  <CircleFlagLanguage languageCode={currentLanguage.code} className='mr-4 h-6 w-6' />
                  {currentLanguage.name}
                </span>
                <span className={`text-sm transition-transform duration-200 ${isLanguageMenuOpen ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>
              {isLanguageMenuOpen && (
                <div className='absolute left-0 mt-2 w-full rounded-md bg-gray-50 shadow-lg'>
                  {languages.map((language) => (
                    <Link
                      key={language.code}
                      href={getLanguagePath(language.code)}
                      className='flex items-center px-4 py-2 text-lg text-gray-700 hover:bg-gray-100'
                      onClick={() => {
                        toggleLanguageMenu()
                        toggleMenu()
                      }}
                    >
                      <CircleFlagLanguage languageCode={language.code} className='mr-2 h-5 w-5' />
                      {language.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <ButtonLeadingToWebapp
              analyticsClickName='sign_in_button_in_mobile_navbar'
              className='mt-4 flex w-full items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 text-2xl text-white transition duration-300 hover:bg-indigo-700 active:bg-indigo-800'
              buttonText={<Trans>Sign in</Trans>}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default MobileNavbar
