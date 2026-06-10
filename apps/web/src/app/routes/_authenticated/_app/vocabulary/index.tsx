import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VocabularyListView } from '@/features/vocabulary/components/vocabulary-list-view'

const vocabularySearchSchema = z.object({
  // Per-term study filter: 'production' = in production study, 'recognition' =
  // recognition-only. Omitted means "All". .catch degrades stale pre-rename
  // URLs (the legacy mode values) to "All" instead of a route error.
  mode: z.enum(['recognition', 'production']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/vocabulary/')({
  validateSearch: vocabularySearchSchema,
  component: VocabularyListView,
})
