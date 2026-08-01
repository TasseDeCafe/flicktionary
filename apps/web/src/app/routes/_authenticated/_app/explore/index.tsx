import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ExploreView } from '@/features/explore/components/explore-view'

// Language filter persisted in the URL so the dashboard section's "See all"
// can deep-link a preselected language; a stale code degrades to All. The
// admin-only status filter is URL-backed too: the detail screen is a separate
// route, so component state would reset to Live on every back-navigation
// while moderating. A non-admin with a crafted ?status= sees nothing — the
// admin query is enabled-gated and the backend 403s.
const exploreSearchSchema = z.object({
  lang: z.string().optional().catch(undefined),
  status: z.enum(['live', 'unshared', 'removed']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/explore/')({
  validateSearch: exploreSearchSchema,
  component: ExploreView,
})
