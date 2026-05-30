import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@lingui/react'
import Bridge from '../bridge'
import VideoSelectUi from '../components/VideoSelectUi'
import { i18n, setupLingui } from '../lingui'

export function renderVideoSelectModeUi(element: Element, language: string) {
  const bridge = new Bridge()
  setupLingui(language)
  createRoot(element).render(
    <I18nProvider i18n={i18n}>
      <VideoSelectUi bridge={bridge} />
    </I18nProvider>
  )
  return bridge
}
