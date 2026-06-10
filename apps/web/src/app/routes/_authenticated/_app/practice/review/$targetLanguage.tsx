import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UnifiedReviewView } from '@/features/practice/components/unified-review-view'

const reviewSearchSchema = z.object({
  // .catch (not .default) so stale pre-rename URLs (pool=passive|active) and
  // garbage degrade to the recognition queue instead of a route error.
  pool: z.enum(['recognition', 'production']).catch('recognition'),
  scope: z.enum(['review_due', 'learn_new', 'mixed']).default('mixed'),
  mode: z.enum(['read', 'flashcards']).default('read'),
  // Explicit learn-new batch size picked on the landing sheet (learn_new +
  // flashcards only). Forwarded to listReviewTerms as newBatchSize.
  count: z.number().int().min(1).max(100).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/practice/review/$targetLanguage')({
  validateSearch: reviewSearchSchema,
  component: UnifiedReviewView,
  staticData: { hideAppChrome: true },
})
