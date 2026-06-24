import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { FocusView } from '@/features/review/components/focus-view'

// `from` lets the close button know where to land. Defaults (absent) to the
// session vocabulary list (the natural parent). The Vocabulary tab passes
// 'vocabulary' so close returns there. A practice surface passes 'practice'
// alongside the language + pool (+ render mode: a reading text omits
// practiceMode and returns to 'read'; the flashcard actions menu passes
// 'flashcards') so close returns to the sessionless review screen for the right
// (language, pool, mode).
const focusViewSearchSchema = z.object({
  from: z.enum(['vocabulary', 'practice']).optional(),
  source: z.enum(['available']).optional(),
  practiceLang: z.string().optional(),
  practicePool: z.enum(['recognition', 'production']).optional().catch(undefined),
  practiceMode: z.enum(['read', 'flashcards']).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/$cardId')({
  validateSearch: focusViewSearchSchema,
  component: FocusView,
  staticData: { hideAppChrome: true },
})
