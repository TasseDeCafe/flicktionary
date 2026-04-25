'use client'

import dynamic from 'next/dynamic'

const DynamicAnalyticsInitializer = dynamic(
  () => import('./dynamic-analytics-initializer').then((mod) => mod.DynamicAnalyticsInitializer),
  { ssr: false }
)

export const AnalyticsInitializer = () => {
  return <DynamicAnalyticsInitializer />
}
