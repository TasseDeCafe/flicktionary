import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VocabularyListView } from '@/features/vocabulary/components/vocabulary-list-view'

const vocabularySearchSchema = z.object({
  // Per-term learning mode filter. Omitted means "All".
  mode: z.enum(['passive', 'active']).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/vocabulary/')({
  validateSearch: vocabularySearchSchema,
  component: VocabularyListView,
})
