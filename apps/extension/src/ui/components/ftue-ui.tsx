import React, { useEffect, useLayoutEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { I18nProvider } from '@lingui/react'
import { TooltipProvider } from '@flicktionary/ui/components/tooltip'
import { getFlicktionaryConfig } from '@/services/flicktionary/flicktionary-config'
import { i18n, setupLingui } from '../lingui'

const useLangParam = () => {
  const [lang, setLang] = useState<string>()
  useEffect(() => setLang(new URLSearchParams(window.location.search).get('lang') ?? undefined), [])
  return lang
}

// The first-time-user-experience page. Always dark (matches the old hardcoded
// MUI dark theme).
const FtueUi = () => {
  const langParam = useLangParam()

  useEffect(() => {
    document.body.classList.add('dark')
  }, [])

  // Layout effect, not render body: i18n.activate() setState()s the mounted
  // <I18nProvider>, which React forbids mid-render. Pre-paint, so no flash.
  useLayoutEffect(() => {
    setupLingui(langParam ?? browser.i18n.getUILanguage())
  }, [langParam])

  return (
    <I18nProvider i18n={i18n}>
      <TooltipProvider>
        <div className='dark bg-background text-foreground flex h-dvh w-dvw flex-col items-center justify-center gap-2 text-center font-sans'>
          <img className='w-[75px]' src={browser.runtime.getURL('/icon/image.png')} />
          <h1 className='text-2xl'>
            <Trans>Welcome to Flicktionary.</Trans>
          </h1>
          <h2 className='text-xl font-medium'>
            <Trans>
              Check out the{' '}
              <a
                className='text-primary underline underline-offset-4'
                target='_blank'
                rel='noreferrer'
                href={`${getFlicktionaryConfig().webUrl}/user-guide`}
              >
                user guide
              </a>{' '}
              to get started.
            </Trans>
          </h2>
        </div>
      </TooltipProvider>
    </I18nProvider>
  )
}

export default FtueUi
