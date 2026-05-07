import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionView } from '@/features/sessions/components/session-view'

const sessionSearchSchema = z.object({
  segment: z.string().uuid().optional(),
  // Lets the X-close button know where to land. Defaults to /sessions; the
  // Vocabulary tab passes 'vocabulary' so close returns there instead.
  from: z.enum(['vocabulary']).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/')({
  validateSearch: sessionSearchSchema,
  component: SessionView,
  staticData: { hideAppChrome: true },
})
