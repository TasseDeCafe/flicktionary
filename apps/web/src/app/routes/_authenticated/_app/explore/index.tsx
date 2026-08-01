import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ExploreView } from '@/features/explore/components/explore-view'

// Language filter persisted in the URL so the dashboard section's "See all"
// can deep-link a preselected language; a stale code degrades to All.
const exploreSearchSchema = z.object({
  lang: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/explore/')({
  validateSearch: exploreSearchSchema,
  component: ExploreView,
})
