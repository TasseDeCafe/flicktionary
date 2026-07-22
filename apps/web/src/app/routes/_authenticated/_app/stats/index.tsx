import { createFileRoute } from '@tanstack/react-router'
import { StatsView } from '@/features/stats/components/stats-view'

export const Route = createFileRoute('/_authenticated/_app/stats/')({
  component: StatsView,
})
