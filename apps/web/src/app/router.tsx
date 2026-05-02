import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }

  // Routes opt out of the app shell (sidebar/tab bar) by setting `hideAppChrome: true`
  // in their `staticData`. AppShellLayout reads this via `useIsModalRoute()` to render
  // the modal-screen pattern (X-close, no chrome) used by Strava/Macrofactor-style
  // full-screen views. Mirrors React Navigation's `presentation: 'modal'` pattern,
  // so the eventual native port is a translation rather than a redesign.
  interface StaticDataRouteOption {
    hideAppChrome?: boolean
  }
}
