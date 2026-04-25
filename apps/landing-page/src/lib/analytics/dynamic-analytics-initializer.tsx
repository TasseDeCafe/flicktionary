'use client'

import { useEffect } from 'react'
import { initializePosthog } from '@/lib/analytics/posthog-initializer'
import { initializeOurAnalytics } from '@/lib/analytics/our-analytics-initializer'

export const DynamicAnalyticsInitializer = () => {
  useEffect(() => {
    const checkAndInitializeAnalytics = async () => {
      await initializePosthog()
      initializeOurAnalytics()
    }
    checkAndInitializeAnalytics()
  }, [])

  return null
}
