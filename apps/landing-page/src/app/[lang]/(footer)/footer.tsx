import Image from 'next/image'
import Link from 'next/link'
import { Trans } from '@lingui/react/macro'
import { LangProps } from '@/types/lang-props'
import LanguageSwitcher from '@/app/[lang]/(components)/language-switcher'
import HiddenButtonLeadingToAdmin from '@/app/(components)/hidden-button-leading-to-admin'
import { FooterNativeAppLinks } from '@/app/[lang]/(footer)/(components)/footer-native-app-links'

const Footer = async ({ lang }: LangProps) => {
  return (
    <footer className='relative flex w-full flex-col items-center gap-y-4 bg-black p-12 text-center text-white'>
      <LanguageSwitcher />
      <FooterNativeAppLinks iosAppText={<Trans>iOS App</Trans>} androidAppText={<Trans>Android App</Trans>} />
      <a href='mailto:contact@app-monorepo-template.dev' className='flex items-center gap-x-2 hover:underline'>
        <Image src='/images/icons/email.svg' alt='template-app logo' width={20} height={20} priority />
        contact@app-monorepo-template.dev
      </a>
      <div className='mt-2'>© {new Date().getFullYear()} TemplateApp.com</div>
      <div className='w-full'>
        <Link href={`/${lang}/privacy-policy`} className='mr-4 hover:underline'>
          <Trans>Privacy Policy</Trans>
        </Link>
        <Link href={`/${lang}/terms-and-conditions`} className='mr-4 hover:underline'>
          <Trans>Terms and Conditions</Trans>
        </Link>
      </div>
      <HiddenButtonLeadingToAdmin />
    </footer>
  )
}

export default Footer
