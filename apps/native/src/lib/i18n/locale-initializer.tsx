import { ReactNode, useEffect } from 'react'
import { Text } from 'react-native'
import { useLocaleStore } from '@/stores/locale-store'
import { I18nProvider, TransRenderProps } from '@lingui/react'
import { i18n, activateLocale } from './i18n'

type LocaleInitializerProps = {
  children: ReactNode
}

// Default component for rendering Trans components without a Text wrapper
const DefaultComponent = (props: TransRenderProps) => {
  return <Text>{props.children}</Text>
}

export const LocaleInitializer = ({ children }: LocaleInitializerProps) => {
  const initialize = useLocaleStore((state) => state.initialize)
  const subscribeToAppState = useLocaleStore((state) => state.subscribeToAppState)
  const locale = useLocaleStore((state) => state.locale)

  // Initialize locale on mount and activate Lingui
  useEffect(() => {
    initialize()
    activateLocale(locale)
    const unsubscribe = subscribeToAppState()
    return unsubscribe
  }, [initialize, subscribeToAppState, locale])

  // Activate Lingui locale when locale changes
  useEffect(() => {
    activateLocale(locale)
  }, [locale])

  return (
    <I18nProvider i18n={i18n} defaultComponent={DefaultComponent}>
      {children}
    </I18nProvider>
  )
}
