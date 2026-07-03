import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (onStoreChange: () => void) => {
  const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY)
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

const getSnapshot = () => window.matchMedia(MOBILE_MEDIA_QUERY).matches

// The snapshot is read synchronously, so the value is known from the very
// first render — consumers never see an "unmeasured" state and can branch
// desktop/mobile without a null-render guard.
export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, getSnapshot)
