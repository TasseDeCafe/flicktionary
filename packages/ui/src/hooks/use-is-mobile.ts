import { useEffect, useState } from 'react'

const MOBILE_BREAKPOINT = 768

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    const handleChange = () => {
      setIsMobile(mediaQuery.matches)
    }

    // Set initial value
    handleChange()

    // Listen for changes
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}
