import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VocabFilterSkillSchema, VocabStatusSchema } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { VocabularyListView } from '@/features/vocabulary/components/vocabulary-list-view'

// Sort & filter state for the Vocabulary tab, persisted in the URL so reload
// and deep-links survive. Every field `.catch`es to undefined, so a stale or
// malformed token (including the retired ?mode= param) degrades to the default
// instead of a route error.
const vocabularySearchSchema = z.object({
  sort: z.enum(['recent', 'due']).optional().catch(undefined),
  status: VocabStatusSchema.optional().catch(undefined),
  skills: z.array(VocabFilterSkillSchema).optional().catch(undefined),
  forms: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/vocabulary/')({
  validateSearch: vocabularySearchSchema,
  component: VocabularyListView,
})
