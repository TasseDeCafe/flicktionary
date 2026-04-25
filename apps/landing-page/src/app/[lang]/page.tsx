import { Metadata } from 'next'
import { Home } from '@/app/[lang]/(components)/home'
import { getConfig } from '@/config/environment-config'
import { LangProps } from '@/types/lang-props'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { msg } from '@lingui/core/macro'

export const generateMetadata = async (props: { params: Promise<LangProps> }): Promise<Metadata> => {
  const params = await props.params

  const { lang } = params

  const { i18n } = await getLinguiInstance(lang)

  return {
    title: i18n._(msg`TemplateApp - Perfect Your Accent with AI Voice Training`),
    description: i18n._(
      msg`Master perfect pronunciation with AI-powered voice cloning. Practice speaking in your target language with your own voice. Try our free trial today!`
    ),
    metadataBase: new URL(getConfig().landingPageUrl),
  }
}

export default Home
