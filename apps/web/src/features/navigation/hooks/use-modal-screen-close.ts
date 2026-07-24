import { useCanGoBack, useNavigate, useRouter, type NavigateOptions } from '@tanstack/react-router'

// Close handler for modal screens and overflow-tab headers with more than one
// entry point: return the user to wherever they actually came from (the
// getting-started checklist opens the new-session wizard from the dashboard,
// but the wizard's parent tab is /sessions). The router stamps an in-app
// history index on every navigation, so canGoBack is false exactly on deep
// links — there we fall back to the screen's fixed parent instead of popping
// out of the app. The fallback replaces the current entry so the closed
// screen doesn't linger in history (browser-back after a fallback close must
// not reopen it).
export const useModalScreenClose = (fallback: NavigateOptions) => {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return () => {
    if (canGoBack) {
      router.history.back()
    } else {
      void navigate({ ...fallback, replace: true })
    }
  }
}
