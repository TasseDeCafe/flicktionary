import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionView } from '@/features/sessions/components/session-view'

const sessionSearchSchema = z.object({
  segment: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/')({
  validateSearch: sessionSearchSchema,
  component: SessionView,
})
