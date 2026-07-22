import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// The app shell's <main> is a persistent scroll container shared by every tab
// view, so without this a scroll position on one tab carries over when
// navigating to another. scrollRestoration resets tracked containers to top on
// fresh navigations and restores their per-location position on back/forward.
// Views with their own restore logic (vocabulary list, session reader) run
// after data loads, so they win over the router's immediate best-effort pass.
export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  scrollToTopSelectors: ['main'],
})

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
