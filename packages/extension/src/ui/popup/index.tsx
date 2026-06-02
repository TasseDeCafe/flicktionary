import { createRoot } from 'react-dom/client'
import { PopupUi } from '../components/PopupUi'
import { AsbplayerSettings } from '@asbplayer-fork/common/settings'

// Map of extension command name → its bound keyboard shortcut, as produced by
// `browser.commands.getAll()` and consumed by `chromeCommandBindsToKeyBinds`.
export type PopupCommands = { [name: string]: string | undefined }

export interface PopupUiParameters {
  currentSettings: AsbplayerSettings
  commands: PopupCommands
}

export async function renderPopupUi(element: Element, { commands }: PopupUiParameters) {
  createRoot(element).render(<PopupUi commands={commands} />)
}
