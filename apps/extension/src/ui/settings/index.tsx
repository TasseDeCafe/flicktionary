import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import SettingsUi from '../components/SettingsUi'
import { makeExtensionQueryClient } from '../query/query-client'

export const renderSettingsUi = (element: Element) => {
  // One QueryClient per options document.
  const queryClient = makeExtensionQueryClient()
  createRoot(element).render(
    <QueryClientProvider client={queryClient}>
      <SettingsUi />
    </QueryClientProvider>
  )
}
