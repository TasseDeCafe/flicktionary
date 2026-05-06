import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { FocusView } from '@/features/review/components/focus-view'

// `from` lets the close button know where to land. Defaults to the triage list
// (the natural parent), but the Vocabulary tab passes 'vocabulary' so close
// returns there instead.
const focusViewSearchSchema = z.object({
  from: z.enum(['triage', 'vocabulary']).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/$cardId')({
  validateSearch: focusViewSearchSchema,
  component: FocusView,
  staticData: { hideAppChrome: true },
})
