import { useEffect, useLayoutEffect } from 'react'
import { useSettings } from '../hooks/use-settings'
import SettingsPage from './SettingsPage'
import { I18nProvider } from '@lingui/react'
import { TooltipProvider } from '@flicktionary/ui/components/tooltip'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { i18n, setupLingui } from '../lingui'

const SettingsUi = () => {
  const { settings, onSettingsChanged, profileContext } = useSettings()

  // Layout effect, not render body: i18n.activate() setState()s the mounted
  // <I18nProvider>, which React forbids mid-render. Pre-paint, so no flash.
  const language = settings?.language
  useLayoutEffect(() => {
    if (language) {
      setupLingui(language)
    }
  }, [language])

  // Radix portals (selects, dialogs, tooltips) target document.body — outside
  // the `dark`-classed root div below — so the dark scope must also land on
  // <body> (same trap as portalContainer in the shadow surfaces).
  const dark = settings?.themeType === 'dark'
  useEffect(() => {
    document.body.classList.toggle('dark', dark)
  }, [dark])

  if (!settings) {
    return null
  }

  return (
    <I18nProvider i18n={i18n}>
      <TooltipProvider>
        <div className={cn('bg-background text-foreground font-sans', dark && 'dark')}>
          <SettingsPage settings={settings} onSettingsChanged={onSettingsChanged} {...profileContext} />
        </div>
      </TooltipProvider>
    </I18nProvider>
  )
}

export default SettingsUi
