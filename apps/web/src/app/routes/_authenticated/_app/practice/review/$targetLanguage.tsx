import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { UnifiedReviewView } from '@/features/practice/components/unified-review-view'

const reviewSearchSchema = z.object({
  pool: z.enum(['passive', 'active']).default('passive'),
  scope: z.enum(['review_due', 'learn_new', 'mixed']).default('mixed'),
  mode: z.enum(['read', 'flashcards']).default('read'),
})

export const Route = createFileRoute('/_authenticated/_app/practice/review/$targetLanguage')({
  validateSearch: reviewSearchSchema,
  component: UnifiedReviewView,
  staticData: { hideAppChrome: true },
})
