import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionReaderRoute } from '@/features/sessions/components/session-reader-route'

const sessionSearchSchema = z.object({
  segment: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/')({
  validateSearch: sessionSearchSchema,
  component: SessionReaderRoute,
  staticData: { hideAppChrome: true },
})
