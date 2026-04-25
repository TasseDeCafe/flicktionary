import Link from 'next/link'
import { LangProps } from '@/types/lang-props'
import { Trans } from '@lingui/react/macro'
import { ButtonLeadingToWebapp } from '@/app/[lang]/(components)/(leading-to-apps)/button-leading-to-webapp'
import DesktopLanguageSwitcher from '@/app/[lang]/(components)/desktop-language-switcher'

const DesktopNavbar = ({ lang }: LangProps) => {
  return (
    <>
      <Link href={`/${lang}`} className='relative flex flex-row items-center'>
        <div className='font-nunito ml-1 hidden flex-col items-center font-semibold text-indigo-600 md:flex'>
          <span className='text-xl leading-4'>TemplateApp</span>
        </div>
      </Link>

      <div className='hidden lg:block'>
        <div className='flex items-center space-x-6'>
          <Link href={`/${lang}/features`} className='text-lg text-gray-600 hover:text-gray-900'>
            <Trans>Features</Trans>
          </Link>
          <Link href={`/${lang}/pricing`} className='text-lg text-gray-600 hover:text-gray-900'>
            <Trans>Pricing</Trans>
          </Link>
          <Link href={`/${lang}/about`} className='text-lg text-gray-600 hover:text-gray-900'>
            <Trans>About</Trans>
          </Link>
          <DesktopLanguageSwitcher lang={lang} />
        </div>
      </div>

      <div className='hidden lg:block'>
        <ButtonLeadingToWebapp
          analyticsClickName='sign_in_button_in_desktop_navbar'
          className='flex min-w-36 items-center justify-center rounded-xl border-2 border-stone-600 px-8 py-2 text-lg font-medium text-stone-900 hover:bg-gray-50 active:bg-gray-100'
          buttonText={<Trans>Sign in</Trans>}
        />
      </div>
    </>
  )
}

export default DesktopNavbar
