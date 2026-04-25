import { setI18n } from '@lingui/react/server'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { LangProps } from '@/types/lang-props'
import { Trans } from '@lingui/react/macro'

const FeaturesSection = async ({ params }: { params: Promise<LangProps> }) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)

  return (
    <div>
      <Trans>Features</Trans>
    </div>
  )
}

export default FeaturesSection
