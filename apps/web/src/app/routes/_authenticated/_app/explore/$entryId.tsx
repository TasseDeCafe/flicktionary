import { createFileRoute } from '@tanstack/react-router'
import { ExploreEntryDetailView } from '@/features/explore/components/explore-entry-detail-view'

export const Route = createFileRoute('/_authenticated/_app/explore/$entryId')({
  component: ExploreEntryDetailView,
  staticData: { hideAppChrome: true },
})
