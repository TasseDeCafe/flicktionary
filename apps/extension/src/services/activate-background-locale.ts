import { SettingsProvider } from '@asbplayer-fork/common/settings'
import { ExtensionSettingsStorage } from './extension-settings-storage'
import { setupLingui } from '../ui/lingui'

const settings = new SettingsProvider(new ExtensionSettingsStorage())

// Activate the user's locale before producing user-facing text from a
// background-realm module. The service worker may have woken fresh to handle a
// message (no startup event fired), so the locale isn't guaranteed active.
// setupLingui no-ops when the locale is already current.
export const activateBackgroundLocale = async (): Promise<void> => {
  setupLingui(await settings.getSingle('language'))
}
