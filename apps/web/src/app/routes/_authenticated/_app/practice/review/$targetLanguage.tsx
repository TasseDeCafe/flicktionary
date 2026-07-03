import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ReadingSessionView } from '@/features/practice/components/reading-session-view'

// Reading-mode-only since the composed queue took over flashcards
// (/practice/composed). Stale URLs carrying the retired mode/count params are
// simply ignored (unknown search keys are stripped).
const reviewSearchSchema = z.object({
  // .catch (not .default) so stale pre-rename URLs (legacy pool values) and
  // garbage degrade to the recognition queue instead of a route error.
  pool: z.enum(['recognition', 'production']).catch('recognition'),
  scope: z.enum(['review_due', 'learn_new', 'mixed']).catch('mixed'),
})

export const Route = createFileRoute('/_authenticated/_app/practice/review/$targetLanguage')({
  validateSearch: reviewSearchSchema,
  component: ReadingSessionView,
  staticData: { hideAppChrome: true },
})
