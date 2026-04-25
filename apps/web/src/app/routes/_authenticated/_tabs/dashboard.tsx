import { createFileRoute } from '@tanstack/react-router'
import { DashboardView } from '@/features/dashboard/components/dashboard-view'

export const Route = createFileRoute('/_authenticated/_tabs/dashboard')({
  component: DashboardView,
})
