import React from 'react'
import { Metadata } from 'next'
import { Trans } from '@lingui/react/macro'
import { setI18n } from '@lingui/react/server'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { msg } from '@lingui/core/macro'
import { LangProps } from '@/types/lang-props'

export const generateMetadata = async (props: { params: Promise<LangProps> }): Promise<Metadata> => {
  const params = await props.params
  const { lang } = params
  const { i18n } = await getLinguiInstance(lang)

  return {
    title: i18n._(msg`About | TemplateApp`),
    description: i18n._(
      msg`the creators of app-monorepo-template.dev here. We've been pouring our hearts into developing the beta version of the app and your feedback is crucial for us. We're excited to roll out new features soon, and we're always looking for ways to improve the app.`
    ),
    alternates: {
      canonical: 'https://www.app-monorepo-template.dev/about',
    },
  }
}

const Page = async ({ params }: { params: Promise<LangProps> }) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)
  return (
    <main
      className='flex w-full flex-1 flex-col items-center justify-center transition-all duration-300 ease-in-out'
      id='main-content'
    >
      <div className='container mx-auto px-4 py-8 md:py-16'>
        <div className='mb-16 flex flex-col items-center justify-center lg:flex-row'>
          <div className='mb-8 w-full lg:mb-0 lg:w-1/2 lg:pr-8'>
            <h1 className='mb-6 text-6xl font-bold text-stone-900'>
              <Trans>About Us</Trans>
            </h1>
          </div>
        </div>
      </div>
    </main>
  )
}

export default Page
