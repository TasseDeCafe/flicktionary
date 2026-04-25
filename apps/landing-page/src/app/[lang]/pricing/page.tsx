import { LangProps } from '@/types/lang-props'
import { Metadata } from 'next'
import { setI18n } from '@lingui/react/server'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { msg } from '@lingui/core/macro'
import { PricingSection } from '@/app/[lang]/(components)/(pricing)/pricing-section'

export const generateMetadata = async (props: { params: Promise<LangProps> }): Promise<Metadata> => {
  const params = await props.params
  const { lang } = params
  const { i18n } = await getLinguiInstance(lang)

  return {
    title: i18n._(msg`Pricing | TemplateApp`),
    description: i18n._(
      msg`Choose the perfect plan for your accent training journey. Flexible pricing options to help you achieve your perfect accent with AI-powered voice training.`
    ),
    alternates: {
      canonical: 'https://www.app-monorepo-template.dev/pricing',
    },
  }
}

const Pricing = async ({ params }: { params: Promise<LangProps> }) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)

  return (
    <div className='mx-auto flex w-full max-w-6xl flex-col items-center gap-y-4 px-1 py-4 md:gap-y-8 md:px-4 md:py-8'>
      <PricingSection />
    </div>
  )
}

export default Pricing
