import { ExtensionSettingsStorage } from '@/services/extension-settings-storage'
import { renderPopupUi, type PopupCommands } from '@/ui/popup'
import { SettingsProvider } from '@asbplayer-fork/common/settings'
import '@/ui/pages.css'

// Radix Select closes itself on any window 'resize' while open, and Firefox
// emits one when the select's portal/scroll-lock mounts and the auto-sized
// popup panel re-measures — every select closed the instant it opened. A
// browser-action popup has no user-driven window resize to react to, so
// swallow the event before Radix's listener (registered later, on content
// mount) can see it.
window.addEventListener('resize', (event) => event.stopImmediatePropagation())

const fetchShortcuts = (): Promise<PopupCommands> => {
  return new Promise((resolve) => {
    if (browser.commands === undefined) {
      resolve({})
      return
    }

    browser.commands.getAll((commands) => {
      const commandsObj: PopupCommands = {}

      for (const c of commands) {
        if (c.name && c.shortcut) {
          commandsObj[c.name] = c.shortcut
        }
      }

      resolve(commandsObj)
    })
  })
}

document.addEventListener('DOMContentLoaded', async (e) => {
  const settings = new SettingsProvider(new ExtensionSettingsStorage())
  const currentSettingsPromise = settings.getAll()
  const commandsPromise = fetchShortcuts()
  const currentSettings = await currentSettingsPromise
  const commands = await commandsPromise
  const rootElement = document.getElementById('root')!
  await renderPopupUi(rootElement, { currentSettings, commands })
})
