import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { FocusView } from '@/features/review/components/focus-view'

// `from` lets the close button know where to land. Defaults (absent) to the
// session vocabulary list (the natural parent). The Vocabulary tab passes
// 'vocabulary' so close returns there. A practice surface passes 'practice'
// alongside the language + pool (+ render mode: a reading text omits
// practiceMode and returns to 'read'; the term actions menu passes the serving
// surface — 'flashcards' for the composed queue, 'strengthen' / 'warmup' for
// the dedicated exercise sessions) so close returns to the right screen.
// 'strengthen' re-enters with `practiceSessionHard` (the again/hard bonus list
// its route carries in the URL); 'warmup' re-enters with
// `practiceStudySessionId` (the session scope its route requires);
// 'flashcards' re-enters with `practiceFilter` (the composed route's search),
// so the interrupted session's stashed snapshot matches and resumes.
const focusViewSearchSchema = z.object({
  from: z.enum(['vocabulary', 'practice']).optional(),
  source: z.enum(['available']).optional(),
  practiceLang: z.string().optional(),
  practicePool: z.enum(['recognition', 'production']).optional().catch(undefined),
  practiceMode: z.enum(['read', 'flashcards', 'strengthen', 'warmup']).optional(),
  practiceStudySessionId: z.string().uuid().optional().catch(undefined),
  practiceSessionHard: z.array(z.string().uuid()).optional().catch(undefined),
  practiceFilter: z
    .object({
      pools: z.array(z.enum(['recognition', 'production'])).min(1),
      scope: z.enum(['due_only', 'new_only', 'both']),
      render: z.enum(['flashcards_only', 'exercises_only', 'both']),
      autoWarmup: z.boolean(),
      includeOptInNew: z.boolean(),
    })
    .optional()
    .catch(undefined),
  // The Daily Mix chain ('flashcards' mode only) — restored on close so an
  // edit-term detour doesn't drop the run.
  practiceMix: z.array(z.string()).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/$cardId')({
  validateSearch: focusViewSearchSchema,
  component: FocusView,
  staticData: { hideAppChrome: true },
})
