import { createFileRoute } from '@tanstack/react-router'
import { PremiumDemoView } from '@/features/premium-demo/components/premium-demo-view'

export const Route = createFileRoute('/_authenticated/premium-demo')({
  component: PremiumDemoView,
})
