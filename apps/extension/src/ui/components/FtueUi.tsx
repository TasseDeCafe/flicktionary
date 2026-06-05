import React, { useEffect, useLayoutEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { I18nProvider } from '@lingui/react'
import { TooltipProvider } from '@flicktionary/ui/components/tooltip'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import Tutorial from './Tutorial'
import { i18n, setupLingui } from '../lingui'

const WelcomeMessage: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', className)}>
      <img className='w-[75px]' src={browser.runtime.getURL('/icon/image.png')} />
      <h1 className='text-2xl'>
        <Trans>Welcome to Flicktionary.</Trans>
      </h1>
      <h2 className='text-xl font-medium'>
        <Trans>
          Scroll down for a quick intro, or check out the{' '}
          <a
            className='text-primary underline underline-offset-4'
            target='_blank'
            rel='noreferrer'
            href={'https://app.flicktionary.app'}
          >
            user guide
          </a>
          .
        </Trans>
      </h2>
    </div>
  )
}

const useLangParam = () => {
  const [lang, setLang] = useState<string>()
  useEffect(() => setLang(new URLSearchParams(window.location.search).get('lang') ?? undefined), [])
  return lang
}

// The first-time-user-experience page. Always dark (matches the old hardcoded
// MUI dark theme).
const FtueUi = () => {
  const langParam = useLangParam()
  const [showTutorial, setShowTutorial] = useState<boolean>(false)
  const [hideWelcomePanel, setHideWelcomePanel] = useState<boolean>(false)

  // Tutorial dialog/bubble content portals to document.body — OUTSIDE the
  // `dark`-classed scroll container — so the dark scope must also land on
  // <body>. The container keeps its own `dark` class to avoid a light-theme
  // flash on the first paint (this effect runs post-render).
  useEffect(() => {
    document.body.classList.add('dark')
  }, [])

  const handleContainerRef = (elm: HTMLDivElement | null) => {
    if (!elm) {
      return
    }

    elm.onscrollend = () => {
      if (elm.scrollTop > (window.innerHeight * 3) / 4) {
        setHideWelcomePanel(true)
        setShowTutorial(true)
      }
    }
  }

  // Layout effect, not render body: i18n.activate() setState()s the mounted
  // <I18nProvider>, which React forbids mid-render. Pre-paint, so no flash.
  useLayoutEffect(() => {
    setupLingui(langParam ?? browser.i18n.getUILanguage())
  }, [langParam])

  return (
    <I18nProvider i18n={i18n}>
      <TooltipProvider>
        <div
          ref={handleContainerRef}
          className='dark bg-background text-foreground h-dvh w-dvw snap-y snap-mandatory overflow-y-scroll font-sans'
        >
          {!hideWelcomePanel && <WelcomeMessage className='h-dvh w-dvw snap-center' />}
          <Tutorial show={showTutorial} className='h-dvh w-dvw snap-center' />
        </div>
      </TooltipProvider>
    </I18nProvider>
  )
}

export default FtueUi
