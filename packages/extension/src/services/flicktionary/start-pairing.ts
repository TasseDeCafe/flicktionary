import { v4 as uuidv4 } from 'uuid'
import { getFlicktionaryConfig } from './flicktionary-config'
import { setPendingFlicktionaryPairNonce } from './pairing-nonce-storage'

// Begins the Flicktionary pairing ("sign in") flow: mint a nonce, stash it for
// the pair handler to verify, then open the web pairing tab. Runs in any
// extension context that can call `browser.tabs.create` (popup, background) —
// content scripts must route through the `flicktionary-start-pairing` command.
export const openFlicktionaryPairingTab = async (): Promise<void> => {
  const nonce = uuidv4()
  await setPendingFlicktionaryPairNonce(nonce)
  const url = `${getFlicktionaryConfig().webUrl}/extension-pair?nonce=${encodeURIComponent(nonce)}`
  await browser.tabs.create({ url, active: true })
}
