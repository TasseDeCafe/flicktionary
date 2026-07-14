import { useEffect, useState } from 'react'

export type ExtensionDetection = 'checking' | 'detected' | 'not-detected'

// The extension's marker content script stamps this attribute on <html> at
// document_start on the web app's origin (flicktionary-marker.content.ts).
const readMarker = (): string | null => document.documentElement.getAttribute('data-flicktionary-extension')

const DETECTION_POLL_INTERVAL_MS = 250
const DETECTION_TIMEOUT_MS = 3000

// Passive per-browser install detection. Starts as 'checking' (never flash
// "not installed" at someone who just installed) and polls briefly to cover
// content-script injection racing the app boot; settles on 'not-detected'
// after the timeout. Note this is a CURRENT-BROWSER signal — the account-level
// "has ever installed" fact lives on user prefs (extension_installed flag).
export const useExtensionDetected = (): ExtensionDetection => {
  const [detection, setDetection] = useState<ExtensionDetection>(() =>
    readMarker() !== null ? 'detected' : 'checking'
  )

  useEffect(() => {
    if (detection !== 'checking') return
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (readMarker() !== null) {
        setDetection('detected')
        window.clearInterval(interval)
      } else if (Date.now() - startedAt >= DETECTION_TIMEOUT_MS) {
        setDetection('not-detected')
        window.clearInterval(interval)
      }
    }, DETECTION_POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [detection])

  return detection
}
