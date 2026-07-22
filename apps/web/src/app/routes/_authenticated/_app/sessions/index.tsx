import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionsListView } from '@/features/sessions/components/sessions-list-view'

// Filter/sort state for the Sessions list, persisted in the URL so reload and
// deep-links survive. Every field `.catch`es to undefined, so a stale or
// malformed token degrades to the default instead of a route error. Search
// text stays local state — transient typing doesn't belong in history.
const sessionsSearchSchema = z.object({
  type: z.enum(['movie', 'tv', 'text', 'article', 'youtube', 'streaming', 'lesson']).optional().catch(undefined),
  lang: z.string().optional().catch(undefined),
  sort: z.enum(['newest', 'oldest']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/')({
  validateSearch: sessionsSearchSchema,
  component: SessionsListView,
})
