import ReactDOM from 'react-dom/client'
import posthog from 'posthog-js'
import { setupReactErrorHandler } from '@posthog/react'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'
import { logError } from '@/lib/analytics/log-error'
import { App } from './provider'
import './index.css'
import { useTrackingStore } from '@/stores/tracking-store'

window.addEventListener('vite:preloadError', (event: VitePreloadErrorEvent) => {
  // https://vite.dev/guide/build#load-error-handling
  // This event listener is needed to fix dynamic import errors caused by clients not having the latest version of the frontend as described in this ticket:
  // https://www.notion.so/grammarians/TypeError-Failed-to-fetch-dynamically-imported-module-122168e7b01a809f9230dc584daefc11?pvs=4
  logError({ message: `vite:preloadError: ${event.payload.message}`, severity: 'debug' })
  window.location.reload()
})

// Initialize tracking params from URL (localStorage values are automatically loaded by Zustand persist)
useTrackingStore.getState().initializeFromUrl()

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root not found in DOM')
}

ReactDOM.createRoot(container, {
  // React 19 error hooks: render errors don't reach window.onerror, so they
  // are captured here (caught, uncaught, and recoverable alike).
  ...(isPostHogEnabled() && {
    onUncaughtError: setupReactErrorHandler(posthog, (_event, error, errorInfo) => {
      console.warn('Uncaught error', error, errorInfo.componentStack)
    }),
    onCaughtError: setupReactErrorHandler(posthog),
    onRecoverableError: setupReactErrorHandler(posthog),
  }),
}).render(<App />)
