// Sentry initialization should be imported first!
import './instrument'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { FEATURES } from '@template-app/core/features'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { App } from './provider'
import './index.css'
import { useTrackingStore } from '@/stores/tracking-store'

window.addEventListener('vite:preloadError', (event: VitePreloadErrorEvent) => {
  // https://vite.dev/guide/build#load-error-handling
  // This event listener is needed to fix dynamic import errors caused by clients not having the latest version of the frontend as described in this ticket:
  // https://www.notion.so/grammarians/TypeError-Failed-to-fetch-dynamically-imported-module-122168e7b01a809f9230dc584daefc11?pvs=4
  logWithSentry({ message: `vite:preloadError: ${event.payload.message}`, severityLevel: 'debug' })
  window.location.reload()
})

// Initialize tracking params from URL (localStorage values are automatically loaded by Zustand persist)
useTrackingStore.getState().initializeFromUrl()

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root not found in DOM')
}

ReactDOM.createRoot(container, {
  // React 19 error hooks for Sentry integration
  // https://docs.sentry.io/platforms/javascript/guides/react/#configure-error-hooks-react-19
  ...(FEATURES.SENTRY && {
    onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
      console.warn('Uncaught error', error, errorInfo.componentStack)
    }),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  }),
}).render(<App />)
