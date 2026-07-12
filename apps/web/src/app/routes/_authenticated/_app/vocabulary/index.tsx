import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VocabFilterSkillSchema, VocabStatusSchema } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import { VocabularyListView } from '@/features/vocabulary/components/vocabulary-list-view'

// Sort & filter state for the Vocabulary tab, persisted in the URL so reload
// and deep-links survive. Every field `.catch`es to undefined, so a stale or
// malformed token (including the retired ?mode= param) degrades to the default
// instead of a route error.
const vocabularySearchSchema = z.object({
  // Deep-link target language (the practice landing's funnel rows link here).
  // Validated against the user's actual languages in the view — a stale code
  // falls back to the saved/first language instead of an empty list.
  lang: z.string().optional().catch(undefined),
  sort: z.enum(['recent', 'due']).optional().catch(undefined),
  status: VocabStatusSchema.optional().catch(undefined),
  skills: z.array(VocabFilterSkillSchema).optional().catch(undefined),
  forms: z.boolean().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/vocabulary/')({
  validateSearch: vocabularySearchSchema,
  component: VocabularyListView,
})
