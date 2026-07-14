// Presence beacon for the web app: stamps a dataset attribute on <html> so
// any web-app page can synchronously detect that the extension is installed
// in this browser (the /extension-welcome page branches on it, and the app
// records the account-level extension_installed fact from it). Purely
// informational — it gates UI copy, not security — so page-spoofability is
// irrelevant. Detection needs no response channel, hence an attribute rather
// than the pairing script's postMessage handshake.

export default defineContentScript({
  matches: [
    'https://app.flicktionary.app/*',
    // Content-script match patterns count as host permissions in Chrome Web
    // Store review, so dev hosts are compiled out of prd builds (the define
    // mirrors the host_permissions gate in wxt.config.ts). Unlike the pairing
    // script this matches every path — the marker must exist wherever the web
    // app runs.
    ...(__FLICKTIONARY_DEV_HOSTS__ ? ['https://*.flicktionary.dev/*', 'http://localhost/*'] : []),
  ],
  runAt: 'document_start',

  main() {
    // documentElement can be briefly absent at document_start; the web-side
    // hook polls for a few seconds, so skipping silently is safe.
    document.documentElement?.setAttribute('data-flicktionary-extension', browser.runtime.getManifest().version)
  },
})
