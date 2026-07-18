import { createFileRoute } from '@tanstack/react-router'
import { CoverageDetailView } from '@/features/coverage/components/coverage-detail-view'

export const Route = createFileRoute('/_authenticated/_app/coverage/$lang')({
  component: CoverageDetailView,
})
