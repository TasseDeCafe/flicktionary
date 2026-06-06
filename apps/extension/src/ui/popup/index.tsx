import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { PopupUi } from '../components/PopupUi'
import { AsbplayerSettings } from '@asbplayer-fork/common/settings'
import { makeExtensionQueryClient } from '../query/query-client'

// Map of extension command name → its bound keyboard shortcut, as produced by
// `browser.commands.getAll()` and consumed by `chromeCommandBindsToKeyBinds`.
export type PopupCommands = { [name: string]: string | undefined }

export interface PopupUiParameters {
  currentSettings: AsbplayerSettings
  commands: PopupCommands
}

export async function renderPopupUi(element: Element, { commands }: PopupUiParameters) {
  // One QueryClient per popup document (the popup fully remounts each open).
  const queryClient = makeExtensionQueryClient()
  createRoot(element).render(
    <QueryClientProvider client={queryClient}>
      <PopupUi commands={commands} />
    </QueryClientProvider>
  )
}
