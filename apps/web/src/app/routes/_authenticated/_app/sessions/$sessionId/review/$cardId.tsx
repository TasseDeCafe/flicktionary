import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { FocusView } from '@/features/review/components/focus-view'

// `from` lets the close button know where to land. Defaults to the triage list
// (the natural parent). The Vocabulary tab passes 'vocabulary' so close
// returns there. A practice text passes 'practice' alongside the session id
// so close (and the cross-jump from prev/next) returns to the right text.
const focusViewSearchSchema = z.object({
  from: z.enum(['triage', 'vocabulary', 'practice']).optional(),
  source: z.enum(['available']).optional(),
  practiceSessionId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/$cardId')({
  validateSearch: focusViewSearchSchema,
  component: FocusView,
  staticData: { hideAppChrome: true },
})
