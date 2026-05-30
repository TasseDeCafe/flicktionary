import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@lingui/react'
import Bridge from '../bridge'
import VideoDataSyncUi from '../components/VideoDataSyncUi'
import { i18n, setupLingui } from '../lingui'

export function renderVideoDataSyncUi(element: Element, language: string) {
  const bridge = new Bridge()
  setupLingui(language)
  createRoot(element).render(
    <I18nProvider i18n={i18n}>
      <VideoDataSyncUi bridge={bridge} />
    </I18nProvider>
  )
  return bridge
}
