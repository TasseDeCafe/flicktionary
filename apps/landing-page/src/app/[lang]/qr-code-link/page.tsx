import { Metadata } from 'next'
import { getConfig } from '@/config/environment-config'
import { LangProps } from '@/types/lang-props'
import { QRCodeLinkPage } from '@/app/[lang]/qr-code-link/(components)/qr-code-link-page'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { msg } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { setI18n } from '@lingui/react/server'

export const generateMetadata = async (props: { params: Promise<LangProps> }): Promise<Metadata> => {
  const params = await props.params
  const { lang } = params
  const { i18n } = await getLinguiInstance(lang)

  return {
    title: i18n._(msg`Download TemplateApp - TemplateApp - Perfect Your Accent with AI Voice Training`),
    description: i18n._(msg`Download our mobile app to start perfecting your accent with AI voice training`),
    metadataBase: new URL(getConfig().landingPageUrl),
  }
}

const QrCodeLinkPage = async ({
  params,
  searchParams,
}: {
  params: Promise<LangProps>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)
  const { referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term } = await searchParams

  return (
    <QRCodeLinkPage
      continueButtonText={<Trans>Continue</Trans>}
      referral={referral as string}
      utm_source={utm_source as string}
      utm_campaign={utm_campaign as string}
      utm_medium={utm_medium as string}
      utm_content={utm_content as string}
      utm_term={utm_term as string}
    />
  )
}

export default QrCodeLinkPage
