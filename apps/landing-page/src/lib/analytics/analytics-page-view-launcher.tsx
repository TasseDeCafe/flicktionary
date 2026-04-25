'use client'

import { useEffect } from 'react'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

export const AnalyticsPageViewLauncher = () => {
  useEffect(() => {
    POSTHOG_EVENTS.viewPage()
  }, [])

  return <></>
}
