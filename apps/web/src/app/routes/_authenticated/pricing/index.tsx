import { createFileRoute } from '@tanstack/react-router'
import { PricingView } from '@/features/billing/components/pricing-view.tsx'

export const Route = createFileRoute('/_authenticated/pricing/')({
  component: PricingView,
})
