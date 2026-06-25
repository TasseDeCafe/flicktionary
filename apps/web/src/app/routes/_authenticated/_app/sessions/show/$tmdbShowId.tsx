import { createFileRoute } from '@tanstack/react-router'
import { ShowDetailView } from '@/features/sessions/components/show-detail-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/show/$tmdbShowId')({
  component: ShowDetailView,
  staticData: { hideAppChrome: true },
})
