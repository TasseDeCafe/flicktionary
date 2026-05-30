import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@lingui/react'
import Bridge from '../bridge'
import { i18n, setupLingui } from '../lingui'
import NotificationUi from '../components/NotificationUi'

export function renderNotificationUi(element: Element, lang: string) {
  const bridge = new Bridge()
  setupLingui(lang)
  createRoot(element).render(
    <I18nProvider i18n={i18n}>
      <NotificationUi bridge={bridge} />
    </I18nProvider>
  )
  return bridge
}
